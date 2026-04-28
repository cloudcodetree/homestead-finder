"""Generic image-refresh pass — works for every source, current and future.

The same failure mode (synthesized or stale image URLs returning a
"Photo not provided" placeholder with HTTP 200) can happen on any
listing source whose CDN is permissive about unknown asset IDs. This
module abstracts the detail-page → real-image-URLs flow into a single
pipeline that any scraper can opt into.

Pipeline per listing
--------------------
1. Fetch the listing's detail page via curl_cffi (Chrome TLS
   impersonation) — works for most CF/Akamai-fronted sources without
   needing Playwright or paid Firecrawl credit.
2. Try the source-specific *regex extractor* if one is registered in
   ``EXTRACTORS`` below. Cheap, fast, runs offline.
3. If the regex returns nothing AND ``claude`` is available locally,
   fall through to a generic AI extraction that reads the HTML and
   asks Claude for real property-photo URLs. Cached on disk so
   re-runs are free.
4. If both fail, write ``images = []`` so the frontend falls through
   to a satellite tile instead of preserving stale junk URLs.

Adding a new source
-------------------
Drop a callable into ``EXTRACTORS[source_name]`` that takes the
detail-page HTML and returns ``list[str]`` of image URLs. If you
don't add one, the AI fallback still runs — so unknown sources are
covered with zero per-source code, just at a small cost per fetch.

Usage
-----
    python -m scraper.image_refresh                        # all sources
    python -m scraper.image_refresh --source landwatch     # one source
    python -m scraper.image_refresh --source landhub --limit 20 --force
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any, Callable

import config
from logger import get_logger

# Reuse LandWatch's existing regex extractor — it's already
# specific + idempotent. Keep importing rather than copy-pasting so
# improvements there flow through here automatically.
from landwatch_images import (
    _ai_fallback_image_urls as ai_fallback_image_urls,
    _extract_image_urls as landwatch_extract,
)

log = get_logger("image_refresh")

# Throttle range — chosen the same as landwatch_images.py for
# consistency. Stays under 1 req/sec serialized per host.
_THROTTLE_MIN_S = 1.0
_THROTTLE_MAX_S = 1.6

# Per-source regex extractors. Functions take the detail-page HTML
# and return ordered list[str] of image URLs. Empty list = "couldn't
# find anything", which triggers the AI fallback path.
ImageExtractor = Callable[[str], list[str]]
EXTRACTORS: dict[str, ImageExtractor] = {
    "landwatch": landwatch_extract,
    # Add new sources here:
    #     "landhub": lambda html: re.findall(r'(https://img\.landhub\.com/[^"\']+\.webp)', html),
    #     "lands_of_america": ...,
}


def _fetch_detail_html(url: str) -> str | None:
    try:
        from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
    except ImportError:
        log.info("[image_refresh] curl_cffi not installed; skip")
        return None
    try:
        r = cffi_requests.get(url, impersonate="chrome131", timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        log.info(f"[image_refresh] fetch {url}: {type(e).__name__}: {e}")
        return None


def _images_look_synthesized(listing: dict[str, Any]) -> bool:
    """Heuristic: are the current image URLs likely synthesized
    placeholders rather than real photo URLs?

    We look for the listing's PID appearing as the trailing ID in the
    URL — the synthesized pattern reused the listing's own PID as the
    photo ID, but real photos use independent CDN-assigned IDs. If
    every URL ends with `-{pid}` it's almost certainly synthesized.
    """
    images = listing.get("images") or []
    if not images:
        return False
    raw_id = str(listing.get("id") or "")
    # Strip the source prefix (`landwatch_`, `landhub_`, etc.) so we
    # match on the bare CDN PID.
    pid = raw_id.split("_", 1)[-1] if "_" in raw_id else raw_id
    if not pid:
        return False
    return all(u.rstrip("/").endswith(f"-{pid}") for u in images)


def _needs_refresh(listing: dict[str, Any], force: bool) -> bool:
    if force:
        return True
    images = listing.get("images") or []
    if not images:
        return True
    return _images_look_synthesized(listing)


def _extract(html: str, source: str, url: str) -> list[str]:
    """Run the per-source extractor first, then the AI fallback."""
    extractor = EXTRACTORS.get(source)
    if extractor is not None:
        try:
            urls = extractor(html)
            if urls:
                return urls[:12]
        except Exception as e:
            log.info(f"[image_refresh] {source} extractor failed: {e}")
    # AI fallback — works regardless of source. Cached against the
    # llm.py on-disk cache so this is free on a re-run.
    return ai_fallback_image_urls(html, url)[:12]


def run(
    input_path: Path,
    *,
    limit: int | None = None,
    force: bool = False,
    source_filter: str | None = None,
) -> dict[str, int]:
    if not input_path.exists():
        print(f"No listings file at {input_path}")
        return {"updated": 0, "skipped": 0, "failed": 0}

    listings: list[dict[str, Any]] = json.loads(input_path.read_text())
    candidates: list[dict[str, Any]] = []
    for item in listings:
        if not item.get("url"):
            continue
        if source_filter and item.get("source") != source_filter:
            continue
        if not _needs_refresh(item, force):
            continue
        candidates.append(item)
    if limit is not None:
        candidates = candidates[:limit]

    print(f"Refreshing images for {len(candidates)}/{len(listings)} rows")

    updated = skipped = failed = 0
    for idx, listing in enumerate(candidates, 1):
        source = listing.get("source") or "unknown"
        url = listing["url"]
        html = _fetch_detail_html(url)
        if idx < len(candidates):
            time.sleep(random.uniform(_THROTTLE_MIN_S, _THROTTLE_MAX_S))
        if not html:
            failed += 1
            continue
        images = _extract(html, source, url)
        if not images:
            # Drop synthesized URLs even when extraction returns
            # nothing — the broken URLs are worse than no URLs at
            # all (frontend can show satellite when images=[]).
            listing["images"] = []
            skipped += 1
            continue
        listing["images"] = images
        updated += 1
        if idx % 10 == 0:
            print(
                f"  [{idx}/{len(candidates)}] "
                f"updated={updated} skipped={skipped} failed={failed}"
            )

    input_path.write_text(json.dumps(listings, indent=2))
    print(f"Done. updated={updated} skipped={skipped} failed={failed}")
    return {"updated": updated, "skipped": skipped, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh image URLs from detail pages — works for all sources"
    )
    parser.add_argument("--source", help="Limit to a single source (e.g. landwatch)")
    parser.add_argument("--limit", type=int, help="Max listings to process")
    parser.add_argument("--force", action="store_true", help="Refresh even if URLs look real")
    parser.add_argument("--input", type=Path, default=config.DATA_DIR / "listings.json")
    args = parser.parse_args()
    if not args.input.exists():
        print(f"Input missing: {args.input}", file=sys.stderr)
        sys.exit(1)
    run(
        args.input,
        limit=args.limit,
        force=args.force,
        source_filter=args.source,
    )


if __name__ == "__main__":
    main()
