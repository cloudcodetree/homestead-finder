"""Run geo enrichment (soil, flood, elevation, watershed) across listings.

Iterates over listings that have lat/lng and no prior `geoEnrichment`
field, runs the orchestrator in parallel (different gov hosts so
threads actually help), and writes results back into each listing.

Usage:
    python -m scraper.enrich_geo                   # all listings w/ lat/lng
    python -m scraper.enrich_geo --state MT        # MT only
    python -m scraper.enrich_geo --limit 5         # test a handful
    python -m scraper.enrich_geo --force           # refresh existing data

No Claude involvement — all lookups hit free government APIs directly,
so this is safe to run in CI or on any machine.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import config
from enrichment.orchestrator import enrich_point
from logger import get_logger

log = get_logger("enrich_geo")


def _has_latlng(listing: dict[str, Any]) -> bool:
    loc = listing.get("location") or {}
    lat = loc.get("lat")
    lng = loc.get("lng")
    return (
        isinstance(lat, (int, float))
        and isinstance(lng, (int, float))
        and lat not in (0, 0.0)
        and lng not in (0, 0.0)
    )


def _needs_geo(listing: dict[str, Any], force: bool) -> bool:
    if force:
        return True
    return not listing.get("geoEnrichment")


def run(
    input_path: Path,
    output_path: Path,
    *,
    state: str | None = None,
    limit: int | None = None,
    force: bool = False,
    concurrency: int = 4,
) -> dict[str, int]:
    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    counters = {
        "total": len(listings),
        "skipped_no_latlng": 0,
        "skipped_already_enriched": 0,
        "skipped_state": 0,
        "skipped_limit": 0,
        "enriched": 0,
        "failed": 0,
    }

    todo: list[int] = []
    for idx, listing in enumerate(listings):
        if state:
            listing_state = (listing.get("location") or {}).get("state", "").upper()
            if listing_state != state.upper():
                counters["skipped_state"] += 1
                continue
        if not _has_latlng(listing):
            counters["skipped_no_latlng"] += 1
            continue
        if not _needs_geo(listing, force=force):
            counters["skipped_already_enriched"] += 1
            continue
        if limit is not None and len(todo) >= limit:
            counters["skipped_limit"] += 1
            continue
        todo.append(idx)

    if not todo:
        output_path.write_text(json.dumps(listings, indent=2))
        return counters

    log.info(f"[geo] enriching {len(todo)} listings with concurrency={concurrency}")
    write_lock = Lock()
    progress = {"done": 0}

    def _work(idx: int) -> tuple[int, dict[str, Any] | None]:
        loc = listings[idx].get("location") or {}
        try:
            return idx, enrich_point(loc["lat"], loc["lng"])
        except Exception as e:
            log.info(f"[geo] {listings[idx].get('id')}: {type(e).__name__}: {e}")
            return idx, None

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_work, idx): idx for idx in todo}
        for fut in as_completed(futures):
            idx, geo = fut.result()
            with write_lock:
                progress["done"] += 1
                listing = listings[idx]
                log.info(
                    f"[geo] {listing.get('id')} "
                    f"({progress['done']}/{len(todo)}): "
                    f"{listing.get('title','')[:50]}"
                )
                if geo is None:
                    counters["failed"] += 1
                    continue
                listing["geoEnrichment"] = {
                    **geo,
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                }
                counters["enriched"] += 1
                # Persist after each to survive Ctrl-C
                output_path.write_text(json.dumps(listings, indent=2))

    output_path.write_text(json.dumps(listings, indent=2))
    return counters


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--input",
        type=Path,
        default=config.DATA_DIR / "listings.json",
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--state", default=None, help="Limit to this state abbr")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    output_path = args.output or args.input
    try:
        counters = run(
            args.input,
            output_path,
            state=args.state,
            limit=args.limit,
            force=args.force,
            concurrency=args.concurrency,
        )
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    summary = ", ".join(f"{k}={v}" for k, v in counters.items() if v)
    print(f"Done. {summary}")
    return 0 if counters["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
