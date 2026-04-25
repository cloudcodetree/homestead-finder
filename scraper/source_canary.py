"""Source-availability canary.

Pings each enabled source's homepage / search-index URL once per run
and reports whether we still get a parseable response. Catches silent
blocks: a source that flips from 200 to 403 (Cloudflare ban) or 200
with empty body (CDN serving us a wall page) won't be obvious until
the next scrape, where we'd just see "0 listings found" — but by
then, hours have passed.

Output:
  Per-source row of (status_code, body_len, ok). Exit 0 if all sources
  pass; exit non-zero (and stdout includes failure markers) if any
  source flipped. The GitHub workflow that wraps this opens a
  GitHub issue on failure.

Designed to run weekly in CI on cheap low-risk URLs only — the
Cloudflare-walled sources (landwatch, craigslist) are LOCAL_ONLY and
NOT pinged from CI to avoid waking up their fingerprint trackers.

Usage:
    python -m source_canary             # ping all enabled sources except local-only
    python -m source_canary --include-local  # also ping local-only (use sparingly)
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from typing import Iterable

import requests

import config
import throttle
from logger import get_logger

log = get_logger("source_canary")


# Per-source canary URL — the cheapest, most-stable URL that proves
# the source is reachable + serving expected content. NOT the search
# URL (those expire quickly); homepage or a known-stable category page.
CANARY_URLS: dict[str, str] = {
    "landwatch": "https://www.landwatch.com/",
    "lands_of_america": "https://www.landsofamerica.com/",
    "homestead_crossing": "https://www.homesteadcrossinginc.com/",
    "ozarkland": "https://www.ozarkland.com/",
    "united_country": "https://www.unitedcountry.com/",
    "mossy_oak": "https://www.mossyoakproperties.com/",
    "craigslist": "https://sapi.craigslist.org/web/v8/postings/search/full?batch=10-0-360-0-0&cc=US&searchPath=rea",
    "landhub": "https://www.landhub.com/",
    "zillow": "https://www.zillow.com/",
    "realtor": "https://www.realtor.com/",
}


@dataclass
class CanaryResult:
    source: str
    url: str
    status: int | None
    body_len: int
    ok: bool
    notes: str = ""


def ping_one(source: str, url: str, *, timeout: float = 12.0) -> CanaryResult:
    """Hit one canary URL with our standard polite headers via the
    throttle layer. Best-effort — never raises."""
    throttle.acquire(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    }
    try:
        r = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        body_len = len(r.text or "")
        # OK = 2xx-3xx + non-empty body. A 200 with body < 1KB usually means
        # we got a wall page or empty payload, not real content.
        ok = 200 <= r.status_code < 400 and body_len > 1024
        notes = ""
        if r.status_code == 403:
            notes = "Cloudflare or anti-bot block"
        elif r.status_code == 429:
            notes = "rate-limited"
        elif r.status_code >= 500:
            notes = "server error"
        elif body_len <= 1024:
            notes = "suspiciously empty body"
        result = CanaryResult(
            source=source,
            url=url,
            status=r.status_code,
            body_len=body_len,
            ok=ok,
            notes=notes,
        )
    except Exception as e:  # noqa: BLE001
        result = CanaryResult(
            source=source, url=url, status=None, body_len=0, ok=False,
            notes=f"{type(e).__name__}: {e}",
        )
    finally:
        throttle.release(url, getattr(locals().get("r", None), "status_code", None))
    return result


def run_canary(*, include_local: bool = False) -> list[CanaryResult]:
    """Run the canary against every enabled source. Skips
    LOCAL_ONLY_SOURCES unless --include-local."""
    targets: list[tuple[str, str]] = []
    for source, enabled in config.ENABLED_SOURCES.items():
        if not enabled:
            continue
        if not include_local and source in config.LOCAL_ONLY_SOURCES:
            continue
        url = CANARY_URLS.get(source)
        if not url:
            continue
        targets.append((source, url))
    return [ping_one(s, u) for s, u in targets]


def format_report(results: Iterable[CanaryResult]) -> str:
    """Markdown report for GitHub issue or stdout. Failures first."""
    rows = list(results)
    failed = [r for r in rows if not r.ok]
    passed = [r for r in rows if r.ok]
    lines = ["# Source canary report\n"]
    if failed:
        lines.append(f"## ❌ {len(failed)} source(s) failing\n")
        lines.append("| Source | Status | Body | Notes |")
        lines.append("|---|---:|---:|---|")
        for r in failed:
            status = str(r.status) if r.status is not None else "—"
            lines.append(
                f"| `{r.source}` | {status} | {r.body_len:,} | {r.notes or '?'} |"
            )
        lines.append("")
    if passed:
        lines.append(f"## ✅ {len(passed)} source(s) healthy\n")
        lines.append("| Source | Status | Body |")
        lines.append("|---|---:|---:|")
        for r in passed:
            lines.append(f"| `{r.source}` | {r.status} | {r.body_len:,} |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(prog="source_canary")
    ap.add_argument(
        "--include-local",
        action="store_true",
        help="Also ping LOCAL_ONLY_SOURCES (Cloudflare-walled). "
        "Skip in CI — wakes up anti-bot trackers.",
    )
    args = ap.parse_args()
    results = run_canary(include_local=args.include_local)
    report = format_report(results)
    print(report)
    if any(not r.ok for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
