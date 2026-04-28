"""Fetch real gallery images for LandWatch listings from their detail pages.

The search-result pages LandWatch serves (what the scraper hits) do
NOT include per-listing image URLs — that content is lazy-loaded via
JS on the detail page. Our synthesized URL pattern
    /resizedimages/360/990/l/80/{N}-{PID}
does NOT match LandWatch's actual CDN layout: the CDN uses distinct
10-digit `imageId`s per photo (e.g. 6042944890, 6042944907), NOT the
listing's PID. Result: synthesized URLs silently return a "Photo not
provided" placeholder jpeg for listings that actually do have photos.

This module fixes that by fetching each LandWatch detail page via
curl_cffi (plain HTTP, ~0.3s per listing, free) and extracting the
real image IDs from the HTML. 94 LandWatch listings × 0.3s ≈ 30s
total wall clock — safe to run after each scrape.

No Firecrawl, no Playwright, no Anthropic API. Pure TLS-impersonated
HTTP against the listing's own detail URL.

Usage:
    python -m scraper.landwatch_images                      # backfill all
    python -m scraper.landwatch_images --limit 5            # test handful
    python -m scraper.landwatch_images --force              # re-fetch
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("landwatch_images")

# Polite throttle between detail-page fetches. Per the project's
# never-get-blacklisted rule we keep this conservative even when
# curl_cffi mimics Chrome — 1.0–1.6s ≈ 0.7 req/sec serialized, well
# under what a human browsing landwatch.com would generate.
_THROTTLE_MIN_S = 1.0
_THROTTLE_MAX_S = 1.6

# resizedimages/{w}/{h}/{orientation}/{quality}/[{crop}/]?{index}-{id}
# We only care about the trailing `{index}-{id}` pair.
_RESIZED_RE = re.compile(r"/resizedimages/[^\"'\s]*?(\d+)-(\d{6,})")
# Fallback: og:image meta tag (always present, exactly one primary image).
_OG_IMAGE_RE = re.compile(r'property="og:image"\s+content="([^"]+)"')

# Preferred served size — wide 360×990 landscape matches our card
# thumbnail aspect ratio (h-32 at w=400 = roughly 2.75:1, which is
# what LandWatch's "990/360/l" variant gives).
_PREFERRED_PATH = "/resizedimages/360/990/l/80/"


def _ai_fallback_image_urls(html: str, url: str) -> list[str]:
    """When the regex extractors return nothing, fall back to a Claude
    pass that reads the (truncated) HTML and tries to find image URLs.

    Idempotent + cached via `llm.call_json`'s on-disk cache, so the
    same listing's HTML hashes to the same response — re-runs cost
    nothing. Bounded to 25KB of HTML to keep prompt tokens cheap.

    Returns an empty list if Claude isn't installed (CI), if the AI
    can't find anything, or if the response is malformed. The caller
    should already have logged the regex miss.
    """
    try:
        import llm
    except Exception:
        return []
    if not llm.is_available():
        return []
    snippet = html[:25000]
    prompt = (
        "Extract every image URL from the HTML below that points to an "
        "actual property photo (not a placeholder, logo, icon, or "
        "stock image). Return JSON: {\"images\": [\"https://…\", …]} "
        "with at most 12 entries, ordered as they appear in the page. "
        "If no real property photos exist, return {\"images\": []}.\n\n"
        f"PAGE URL: {url}\n\nHTML:\n{snippet}"
    )
    try:
        result = llm.call_json(prompt, tag="landwatch_images_ai")
    except Exception as e:
        log.info(f"[landwatch_images] AI fallback failed: {type(e).__name__}: {e}")
        return []
    if not isinstance(result, dict):
        return []
    images = result.get("images") or []
    return [u for u in images if isinstance(u, str) and u.startswith("http")][:12]


def _extract_image_urls(html: str) -> list[str]:
    """Pull all unique LandWatch image IDs from a detail page's HTML and
    build normalized gallery URLs at our preferred size.

    LandWatch's detail pages expose image URLs in three shapes:
      1. og:image meta tag (primary, always present)
      2. <link rel="preload" as="image" href="..."/> (gallery preloads)
      3. inline <img> / <source srcset> tags (thumbnails + zoom variants)
    All route through `/resizedimages/{w}/{h}/.../{N}-{id}`. We dedupe
    by `{index}-{id}` pair so a 600px and 150px variant of the same
    photo don't produce two gallery slots. Returns ordered list —
    primary first (from og:image), then others in document order.
    """
    ids_seen: set[str] = set()
    ordered: list[str] = []

    # Start with og:image so the primary photo is always images[0].
    og_match = _OG_IMAGE_RE.search(html)
    if og_match:
        m = _RESIZED_RE.search(og_match.group(1))
        if m:
            key = f"{m.group(1)}-{m.group(2)}"
            ids_seen.add(key)
            ordered.append(
                f"https://assets.landwatch.com{_PREFERRED_PATH}{key}"
            )

    # Walk the whole document for remaining images.
    for m in _RESIZED_RE.finditer(html):
        key = f"{m.group(1)}-{m.group(2)}"
        if key in ids_seen:
            continue
        ids_seen.add(key)
        ordered.append(f"https://assets.landwatch.com{_PREFERRED_PATH}{key}")

    return ordered


def _fetch_detail_html(url: str) -> str | None:
    """Fetch a LandWatch detail page via curl_cffi. Chrome TLS
    impersonation is required — plain requests hits CF 403."""
    try:
        from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
    except ImportError:
        log.info("[landwatch_images] curl_cffi not installed; skip")
        return None
    try:
        r = cffi_requests.get(url, impersonate="chrome131", timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        log.info(f"[landwatch_images] fetch failed {url}: {type(e).__name__}: {e}")
        return None


def _needs_refresh(listing: dict[str, Any], force: bool) -> bool:
    """Re-fetch when forced, or when the current `images` array is
    empty or full of our (known-broken) `{N}-{PID}` synthesis (PID
    doesn't match LandWatch's real image ID pattern)."""
    if force:
        return True
    images = listing.get("images") or []
    if not images:
        return True
    # If ANY image URL ends with the listing's own PID, it's a synthesized
    # placeholder URL that serves "Photo not provided" — refresh.
    pid = str(listing.get("id", "")).replace("landwatch_", "")
    if pid and any(u.rstrip("/").endswith(f"-{pid}") for u in images):
        return True
    return False


def run(
    input_path: Path,
    *,
    limit: int | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Backfill LandWatch listings in `input_path` with real gallery
    images extracted from their detail pages. Writes back to the
    same file. Idempotent — listings already carrying real image
    URLs are skipped unless `force`.
    """
    if not input_path.exists():
        print(f"No listings file at {input_path}")
        return {"updated": 0, "skipped": 0, "failed": 0}

    listings: list[dict[str, Any]] = json.loads(input_path.read_text())
    candidates = [
        item
        for item in listings
        if item.get("source") == "landwatch"
        and item.get("url")
        and _needs_refresh(item, force)
    ]
    if limit is not None:
        candidates = candidates[:limit]

    print(f"Refreshing images for {len(candidates)}/{len(listings)} rows")

    updated = skipped = failed = 0
    for idx, listing in enumerate(candidates, 1):
        url = listing["url"]
        html = _fetch_detail_html(url)
        # Polite jitter between requests regardless of success — failed
        # fetches usually mean we hit a transient block, and pounding
        # back-to-back makes that worse.
        if idx < len(candidates):
            time.sleep(random.uniform(_THROTTLE_MIN_S, _THROTTLE_MAX_S))
        if not html:
            failed += 1
            continue
        images = _extract_image_urls(html)
        if not images:
            # Regexes missed — fall through to Claude (cached, free
            # against the Max subscription per ADR-012). Useful when
            # LandWatch ships a fresh detail-page layout that moves
            # photos out of `<meta property="og:image">` and the
            # `/resizedimages/...` path. No-op if `claude` isn't on
            # PATH (i.e. CI).
            images = _ai_fallback_image_urls(html, url)
        if not images:
            # No og:image, no resizedimages on the page, AI fallback
            # also returned nothing. Drop the (broken) synthesized
            # URLs we previously wrote so the frontend falls through
            # to the satellite tile instead of "Photo not provided".
            listing["images"] = []
            skipped += 1
            continue
        # Cap to 12 — gallery pages rarely show more than 8-10 photos
        # and we don't want a listings.json bloat.
        listing["images"] = images[:12]
        updated += 1
        if idx % 10 == 0:
            print(f"  [{idx}/{len(candidates)}] updated={updated} failed={failed}")

    input_path.write_text(json.dumps(listings, indent=2))
    print(f"Done. updated={updated} skipped={skipped} failed={failed}")
    return {"updated": updated, "skipped": skipped, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh LandWatch gallery URLs from detail pages"
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--input", type=Path, default=config.DATA_DIR / "listings.json"
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Input missing: {args.input}", file=sys.stderr)
        sys.exit(1)
    run(args.input, limit=args.limit, force=args.force)


if __name__ == "__main__":
    main()
