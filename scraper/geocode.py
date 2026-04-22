"""Geocode listings that lack lat/lng using Nominatim (OpenStreetMap).

The scraper emits rows with `location.lat = 0, location.lng = 0` when
the source doesn't provide coordinates directly — which is the common
case for our HTML-scraped sources (LandWatch search pages,
HomesteadCrossing cards, OzarkLand). Without coords the Map view is
empty and the geo-enrichment pipeline (scraper.enrich_geo) can't run.

This module fills the gap cheaply:

  1. Build a best-effort locality string from the listing
     (`title, county, state` — never the street, because most scraped
     titles are marketing labels like "Wolf Creek #2" that Nominatim
     won't resolve anyway).
  2. Hit Nominatim's /search endpoint with a short timeout.
  3. Write lat/lng + a `geocodeSource: "nominatim_locality"` stamp so
     downstream code knows this is a locality-level guess, not a parcel
     coordinate.

Nominatim fair-use: 1 request/second, attribution required, cache
results. We sleep 1.1s between calls and cache hits by
`{state}/{county}` centroid — a county-centroid is usually close
enough for soil/flood/elevation/watershed lookups (~30 miles apart
samples already produce meaningful homestead signals).

Usage:
    python -m scraper.geocode                     # all listings missing coords
    python -m scraper.geocode --limit 10          # test a few first
    python -m scraper.geocode --force             # re-geocode even if already set
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("geocode")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim fair-use policy requires a descriptive, contactable UA.
# Swap in your own email before running on a shared/production machine.
USER_AGENT = "homestead-finder/1.0 (https://github.com/cloudcodetree/homestead-finder)"
SLEEP_BETWEEN_CALLS = 1.1  # seconds; Nominatim fair-use is ~1/sec


def _normalize_county(raw: str) -> str:
    """Drop the ' County' suffix for the Nominatim query — N matches
    'Howell' more reliably than 'Howell County' for rural MO/AR."""
    s = (raw or "").strip()
    return s[:-7].strip() if s.lower().endswith(" county") else s


def _build_query(listing: dict[str, Any]) -> str | None:
    loc = listing.get("location") or {}
    state = (loc.get("state") or "").strip()
    county = _normalize_county(loc.get("county") or "")
    if not state:
        return None
    # County + state → stable county-centroid. Adding the (often
    # marketing) title only hurts match quality so we skip it.
    return f"{county} County, {state}, USA" if county else f"{state}, USA"


def _nominatim_lookup(query: str) -> tuple[float, float] | None:
    """Hit Nominatim /search for the given query, return lat/lng or None.
    Non-fatal on any error — caller treats None as 'skip and try next'."""
    params = {
        "q": query,
        "format": "json",
        "limit": "1",
        "countrycodes": "us",
    }
    url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception as e:
        log.info(f"[geocode] Nominatim call failed for {query!r}: {e}")
        return None
    if not data:
        return None
    try:
        return float(data[0]["lat"]), float(data[0]["lon"])
    except (KeyError, ValueError, IndexError):
        return None


def _needs_geocode(listing: dict[str, Any], force: bool) -> bool:
    loc = listing.get("location") or {}
    lat = loc.get("lat") or 0
    lng = loc.get("lng") or 0
    if force:
        return True
    return lat in (0, 0.0) or lng in (0, 0.0)


def run(
    path: Path,
    *,
    limit: int | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Geocode all listings in `path` missing lat/lng.

    Caches lookups per {state,county} so the 176-listing Ozark corpus
    hits Nominatim only for the unique county set (typically <20).
    """
    if not path.exists():
        print(f"No listings file at {path}")
        return {"updated": 0, "skipped": 0, "failed": 0}

    listings: list[dict[str, Any]] = json.loads(path.read_text())
    centroid_cache: dict[tuple[str, str], tuple[float, float] | None] = {}

    candidates = [item for item in listings if _needs_geocode(item, force)]
    if limit is not None:
        candidates = candidates[:limit]

    print(
        f"Geocoding {len(candidates)}/{len(listings)} listings "
        f"(force={force}, limit={limit})"
    )

    updated = skipped = failed = 0
    for idx, listing in enumerate(candidates, 1):
        loc = listing.get("location") or {}
        key = (
            (loc.get("state") or "").upper(),
            _normalize_county(loc.get("county") or "").lower(),
        )
        if not key[0]:
            skipped += 1
            continue

        if key in centroid_cache:
            result = centroid_cache[key]
        else:
            query = _build_query(listing)
            if not query:
                centroid_cache[key] = None
                result = None
            else:
                time.sleep(SLEEP_BETWEEN_CALLS)
                result = _nominatim_lookup(query)
                centroid_cache[key] = result

        if result is None:
            failed += 1
            if idx % 10 == 0:
                print(f"  [{idx}/{len(candidates)}] geocoded={updated} failed={failed}")
            continue

        lat, lng = result
        loc = listing.setdefault("location", {})
        loc["lat"] = lat
        loc["lng"] = lng
        listing["geocodeSource"] = "nominatim_locality"
        listing["geocodedAt"] = datetime.now(timezone.utc).isoformat()
        updated += 1
        if idx % 10 == 0:
            print(f"  [{idx}/{len(candidates)}] geocoded={updated} failed={failed}")

    path.write_text(json.dumps(listings, indent=2))
    print(
        f"Done. updated={updated} skipped={skipped} failed={failed} "
        f"(unique counties queried: {len([v for v in centroid_cache.values() if v])}/"
        f"{len(centroid_cache)})"
    )
    return {"updated": updated, "skipped": skipped, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill lat/lng via Nominatim")
    parser.add_argument("--limit", type=int, help="Only process the first N listings")
    parser.add_argument(
        "--force", action="store_true", help="Re-geocode even if coords already set"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=config.DATA_DIR / "listings.json",
        help="Path to listings JSON (default: data/listings.json)",
    )
    args = parser.parse_args()

    if args.input is None or not args.input.exists():
        print(f"Input file missing: {args.input}", file=sys.stderr)
        sys.exit(1)

    run(args.input, limit=args.limit, force=args.force)


if __name__ == "__main__":
    main()
