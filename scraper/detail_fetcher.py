"""Fetch LandWatch listing-detail pages and extract richer fields.

The search-result pages our scraper hits don't include lat/lng or full
descriptions — those live on per-listing detail pages. This module pulls
a detail page via Firecrawl and extracts:

    - lat/lng (from the embedded AcreValue research link which always
      contains the parcel's coordinate)
    - full description
    - outbound links to third-party property research tools (AcreValue,
      Land id, First Street, CoStar, Google Maps)

Results feed into the geo-enrichment pipeline and show up as
"Research this parcel" deep links in the frontend detail view.

Usage:
    python -m scraper.detail_fetcher                   # backfill all
    python -m scraper.detail_fetcher --limit 5         # first 5 only
    python -m scraper.detail_fetcher --state MT        # MT only
    python -m scraper.detail_fetcher --force           # refetch even if cached
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import config
from logger import get_logger
from strategies.firecrawl_strategy import FirecrawlStrategy

log = get_logger("detail_fetcher")


# Pattern: LandWatch embeds the parcel lat/lng in an AcreValue "research"
# link. Example: https://www.acrevalue.com/map/?lat=47.06&lng=-112.24&...
_LATLNG_RE = re.compile(r"lat=([-\d.]+)&lng=([-\d.]+)")

# Third-party property research tools our listings link out to.
_THIRD_PARTY_DOMAINS = {
    "acrevalue.com": "acreValue",
    "id.land": "landId",
    "firststreet.org": "firstStreet",
    "costar.com": "coStar",
}


def _extract_latlng(markdown: str) -> tuple[float, float] | None:
    """Pull the parcel coordinate out of the AcreValue URL, if present."""
    match = _LATLNG_RE.search(markdown)
    if not match:
        return None
    try:
        return float(match.group(1)), float(match.group(2))
    except ValueError:
        return None


def _extract_description(markdown: str) -> str:
    """Return the longest contiguous paragraph on the page — that's the
    listing description. The search-result blurbs are ~200-500 chars;
    detail-page descriptions run 1000+ chars.
    """
    paragraphs = [p.strip() for p in markdown.split("\n\n")]
    candidates = [p for p in paragraphs if len(p) > 200 and not p.startswith("[")]
    if not candidates:
        return ""
    return max(candidates, key=len)[:3000]


def _extract_external_links(markdown: str) -> dict[str, str]:
    """Pull out the first URL we see for each known third-party property
    tool. Returned dict uses camelCase keys matching the frontend type.
    """
    result: dict[str, str] = {}
    # Match [text](url) markdown links; simple enough for external refs.
    link_re = re.compile(r"\]\((https?://[^)]+)\)")
    for url in link_re.findall(markdown):
        for domain, key in _THIRD_PARTY_DOMAINS.items():
            if domain in url and key not in result:
                result[key] = url
    return result


def fetch_detail(url: str, strategy: FirecrawlStrategy) -> dict[str, Any] | None:
    """Fetch and parse one LandWatch detail page. Returns None on any failure."""
    try:
        fetched = strategy.fetch(url, formats=["markdown"])
    except Exception as e:
        log.info(f"[detail] fetch failed for {url}: {e}")
        return None

    markdown = fetched.content or ""
    if len(markdown) < 500:
        # Likely an error page or captcha — skip.
        log.info(f"[detail] suspiciously short response ({len(markdown)}) for {url}")
        return None

    latlng = _extract_latlng(markdown)
    return {
        "lat": latlng[0] if latlng else None,
        "lng": latlng[1] if latlng else None,
        "description": _extract_description(markdown),
        "externalLinks": _extract_external_links(markdown),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def _needs_detail(listing: dict[str, Any], force: bool) -> bool:
    if force:
        return True
    loc = listing.get("location") or {}
    # Consider listings fetched once when lat/lng is populated and
    # detailFetchedAt is set; re-fetch on force only.
    return not (
        listing.get("detailFetchedAt")
        and loc.get("lat") not in (None, 0, 0.0)
        and loc.get("lng") not in (None, 0, 0.0)
    )


def backfill(
    input_path: Path,
    output_path: Path,
    *,
    state: str | None = None,
    limit: int | None = None,
    force: bool = False,
    concurrency: int = 4,
) -> dict[str, int]:
    """Fetch detail pages for listings missing lat/lng and merge back into the file."""
    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    todo: list[int] = []
    counters = {"total": len(listings), "skipped": 0, "fetched": 0, "failed": 0}
    for idx, listing in enumerate(listings):
        if (
            state
            and (listing.get("location") or {}).get("state", "").upper()
            != state.upper()
        ):
            counters["skipped"] += 1
            continue
        if not _needs_detail(listing, force=force):
            counters["skipped"] += 1
            continue
        if limit is not None and len(todo) >= limit:
            counters["skipped"] += 1
            continue
        todo.append(idx)

    if not todo:
        output_path.write_text(json.dumps(listings, indent=2))
        return counters

    strategy = FirecrawlStrategy()
    if not strategy.is_available():
        raise RuntimeError(
            "Firecrawl unavailable — set FIRECRAWL_API_KEY and install firecrawl-py"
        )

    log.info(
        f"[detail] fetching {len(todo)} detail pages with concurrency={concurrency}"
    )
    write_lock = Lock()
    progress = {"done": 0}

    def _work(idx: int) -> tuple[int, dict[str, Any] | None]:
        listing = listings[idx]
        return idx, fetch_detail(listing.get("url", ""), strategy)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_work, idx): idx for idx in todo}
        for fut in as_completed(futures):
            idx, detail = fut.result()
            with write_lock:
                progress["done"] += 1
                listing = listings[idx]
                log.info(
                    f"[detail] {listing.get('id')} "
                    f"({progress['done']}/{len(todo)}): "
                    f"{listing.get('title','')[:50]}"
                )
                if detail is None:
                    counters["failed"] += 1
                    continue

                # Merge lat/lng into location
                loc = listing.setdefault("location", {})
                if detail.get("lat") is not None:
                    loc["lat"] = detail["lat"]
                if detail.get("lng") is not None:
                    loc["lng"] = detail["lng"]

                # Replace truncated description with the full one if present.
                if detail.get("description"):
                    listing["description"] = detail["description"]

                if detail.get("externalLinks"):
                    listing["externalLinks"] = detail["externalLinks"]
                listing["detailFetchedAt"] = detail["fetchedAt"]
                counters["fetched"] += 1
                # Persist after each completion so we don't lose work on Ctrl-C
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
        counters = backfill(
            args.input,
            output_path,
            state=args.state,
            limit=args.limit,
            force=args.force,
            concurrency=args.concurrency,
        )
    except (RuntimeError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(
        f"Done. total={counters['total']} "
        f"fetched={counters['fetched']} "
        f"skipped={counters['skipped']} "
        f"failed={counters['failed']}"
    )
    return 0 if counters["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
