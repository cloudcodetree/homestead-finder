"""Per-source health check — diff today's corpus against the most
recent snapshot and surface big regressions.

The scraper has many ways to silently degrade:
  - Anti-bot wall blocks every request → source returns 0 listings
  - DOM rename → parser falls through and matches nothing
  - CDN path change → image array stays full of placeholder URLs
  - Detail-fetcher route returns 404 → coords drop to 0,0

Each of these can happen without raising exceptions, so the daily
job appears to "succeed" while the corpus quietly rots. This module
compares week-over-week on per-source metrics and flags drops that
exceed configured thresholds. Three modes:

  - `summary` — print a readable one-shot report (default).
  - `--alert` — additionally email an alert via the existing notifier
    if any threshold was breached. Suitable for the daily CI run.
  - `--json` — emit a machine-readable summary to stdout.

Metrics tracked, per source:
  - listing count
  - % with non-zero coords (geo-coverage)
  - % with non-empty `images[]` (image-coverage)
  - % with `dealScore >= 75` (hot-deal share — a sanity check; if it
    swings 50%+, scoring or input distributions changed)

Thresholds default to a 25% relative drop in any metric. Reasonable
day-to-day churn from new listings + sold-listings rolling off should
stay well under that. Customize per metric via CLI flags.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("health_check")


def _load(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError) as e:
        log.info(f"[health_check] failed to load {path}: {e}")
        return []


def _per_source_stats(listings: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    by_source: dict[str, list[dict[str, Any]]] = {}
    for item in listings:
        s = item.get("source") or "unknown"
        by_source.setdefault(s, []).append(item)
    stats: dict[str, dict[str, float]] = {}
    for source, rows in by_source.items():
        n = len(rows)
        with_geo = sum(
            1
            for r in rows
            if (r.get("location") or {}).get("lat") not in (None, 0, 0.0)
        )
        with_images = sum(1 for r in rows if r.get("images"))
        hot = sum(1 for r in rows if (r.get("dealScore") or 0) >= 75)
        stats[source] = {
            "count": float(n),
            "geo_pct": (with_geo / n * 100.0) if n else 0.0,
            "images_pct": (with_images / n * 100.0) if n else 0.0,
            "hot_pct": (hot / n * 100.0) if n else 0.0,
        }
    return stats


def _latest_snapshot(corpus_dir: Path, exclude: Path | None) -> Path | None:
    """Return the newest `listings_YYYYMMDD.json` snapshot that isn't
    the file we're comparing against. Returns None if no snapshot
    exists yet (first run)."""
    candidates = sorted(corpus_dir.glob("listings_*.json"), reverse=True)
    for p in candidates:
        if exclude and p.resolve() == exclude.resolve():
            continue
        return p
    return None


def _compare(
    today: dict[str, dict[str, float]],
    prev: dict[str, dict[str, float]],
    drop_threshold_pct: float,
) -> list[dict[str, Any]]:
    """Return one row per (source, metric) breach. drop_threshold_pct is
    an absolute number like 25.0 (= "drop of 25% or more is flagged").
    Sources newly appearing are not flagged; sources that vanished
    entirely are flagged on `count`."""
    breaches: list[dict[str, Any]] = []
    for source, today_metrics in today.items():
        prev_metrics = prev.get(source)
        if not prev_metrics:
            continue
        for metric, today_value in today_metrics.items():
            prev_value = prev_metrics.get(metric, 0.0)
            if prev_value <= 0:
                continue
            delta_pct = (today_value - prev_value) / prev_value * 100.0
            if delta_pct <= -drop_threshold_pct:
                breaches.append({
                    "source": source,
                    "metric": metric,
                    "before": prev_value,
                    "after": today_value,
                    "delta_pct": delta_pct,
                })
    # Surfacing source disappearances explicitly — `_per_source_stats`
    # won't include sources with 0 listings today.
    for source in prev.keys() - today.keys():
        breaches.append({
            "source": source,
            "metric": "count",
            "before": prev[source]["count"],
            "after": 0.0,
            "delta_pct": -100.0,
        })
    return breaches


def _format_report(
    today: dict[str, dict[str, float]],
    prev: dict[str, dict[str, float]] | None,
    breaches: list[dict[str, Any]],
) -> str:
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("Homestead Finder — daily health check")
    lines.append("=" * 72)
    if prev is None:
        lines.append("(no prior snapshot found — recording today as baseline)")
    lines.append("")
    lines.append(f"{'source':<22} {'count':>8} {'geo%':>7} {'img%':>7} {'hot%':>7}")
    lines.append("-" * 60)
    for source in sorted(today.keys()):
        m = today[source]
        lines.append(
            f"{source:<22} {int(m['count']):>8} "
            f"{m['geo_pct']:>6.1f}% {m['images_pct']:>6.1f}% {m['hot_pct']:>6.1f}%"
        )
    if breaches:
        lines.append("")
        lines.append(f"⚠ {len(breaches)} threshold breach(es):")
        for b in breaches:
            lines.append(
                f"  {b['source']}: {b['metric']} "
                f"{b['before']:.1f} → {b['after']:.1f} "
                f"({b['delta_pct']:+.1f}%)"
            )
    else:
        lines.append("")
        lines.append("✓ all metrics within thresholds.")
    return "\n".join(lines)


def _send_alert(report: str, breach_count: int) -> bool:
    """Email the report via SendGrid if configured. Reuses the same
    notifier path as the deal alerts so we don't add a second
    integration. Subject line includes the breach count so an inbox
    rule can skip routine clean reports."""
    try:
        import sendgrid
        from sendgrid.helpers.mail import Mail
    except ImportError:
        log.info("[health_check] sendgrid not installed; skipping alert")
        return False
    if not config.SENDGRID_API_KEY or not config.NOTIFICATION_EMAIL:
        log.info("[health_check] no SendGrid creds; skipping alert")
        return False
    subject = (
        f"🚨 Homestead Finder health: {breach_count} regression(s)"
        if breach_count
        else "✓ Homestead Finder health: clean"
    )
    try:
        sg = sendgrid.SendGridAPIClient(api_key=config.SENDGRID_API_KEY)
        msg = Mail(
            from_email="homestead-finder@noreply.com",
            to_emails=config.NOTIFICATION_EMAIL,
            subject=subject,
            html_content=f"<pre>{report}</pre>",
        )
        resp = sg.client.mail.send.post(request_body=msg.get())
        return resp.status_code in (200, 202)
    except Exception as e:
        log.info(f"[health_check] alert failed: {e}")
        return False


def run(
    today_path: Path,
    *,
    snapshot_path: Path | None = None,
    drop_pct: float = 25.0,
    alert: bool = False,
    emit_json: bool = False,
) -> dict[str, Any]:
    today_listings = _load(today_path)
    today_stats = _per_source_stats(today_listings)
    if snapshot_path is None:
        snapshot_path = _latest_snapshot(config.DATA_DIR, today_path)
    prev_listings = _load(snapshot_path) if snapshot_path else []
    prev_stats = _per_source_stats(prev_listings) if prev_listings else None

    breaches = _compare(today_stats, prev_stats, drop_pct) if prev_stats else []
    report = _format_report(today_stats, prev_stats, breaches)

    if emit_json:
        payload = {
            "today": today_stats,
            "previous": prev_stats,
            "breaches": breaches,
            "snapshot": str(snapshot_path) if snapshot_path else None,
            "date": date.today().isoformat(),
        }
        print(json.dumps(payload, indent=2))
    else:
        print(report)

    if alert and breaches:
        _send_alert(report, len(breaches))

    return {
        "breach_count": len(breaches),
        "today": today_stats,
        "previous": prev_stats,
        "report": report,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Diff today's corpus against the latest snapshot and flag regressions"
    )
    parser.add_argument(
        "--input", type=Path, default=config.DATA_DIR / "listings.json",
        help="Current corpus to evaluate (default: data/listings.json)",
    )
    parser.add_argument(
        "--snapshot", type=Path, default=None,
        help="Specific snapshot to compare against (default: newest dated file in data/)",
    )
    parser.add_argument(
        "--drop-pct", type=float, default=25.0,
        help="Relative drop threshold (default: 25 = 25%%)",
    )
    parser.add_argument(
        "--alert", action="store_true",
        help="Email a summary via SendGrid if any breach is detected",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit machine-readable JSON instead of the human report",
    )
    args = parser.parse_args()
    if not args.input.exists():
        print(f"Input missing: {args.input}", file=sys.stderr)
        sys.exit(1)
    result = run(
        args.input,
        snapshot_path=args.snapshot,
        drop_pct=args.drop_pct,
        alert=args.alert,
        emit_json=args.json,
    )
    sys.exit(2 if result["breach_count"] > 0 else 0)


if __name__ == "__main__":
    main()
