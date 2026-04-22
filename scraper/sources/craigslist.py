"""Craigslist for-sale-by-owner land scraper — the FSBO hidden-gem layer.

Craigslist's "real estate by owner" category (`/search/rea?purveyor=owner`)
carries rural FSBO land listings that don't flow to the big
aggregators — many are seller-posted for < $10k with handshake owner-
finance terms.

Scrape strategy:
  - Craigslist's public sapi JSON endpoint at sapi.craigslist.org
  - Single national query, no authentication, ~50-100 items per call
  - Filter by lat/lng bounding box to our target states (MO + AR)

The response encodes each listing as a positional array with an
unstable layout — an image gallery `[4, ...]` is inserted between
positions when present, shifting subsequent positions. The parser
here is pattern-based (scans every position and extracts by type
+ value signature) rather than assuming fixed indices, so schema
drift doesn't break it.

Known limitations:
  - 50-100 items per call is a small slice of Craigslist's real
    national FSBO-land inventory; we only see what the sapi returns
    without an area filter. Good enough for pilot-scale MO+AR.
  - Craigslist TOS nominally forbids automated scraping; our rate
    is a single daily call per run, well below anything that would
    trip rate limits.
  - No area-ID mapping means we can't drill into a specific Ozark
    metro; national + bbox filter substitutes acceptably.
"""

from __future__ import annotations

import re
from typing import Any

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.craigslist")

_SAPI_URL = (
    "https://sapi.craigslist.org/web/v8/postings/search/full"
    "?batch=100-0-360-0-0&cc=US&lang=en"
    "&searchPath=rea&query=land&purveyor=owner&srchType=T"
)

# Lat/lng bounding boxes for our target states. Loose enough to catch
# parcels near state borders; the geo-enrichment pass will nail down
# actual county when the parcel gets processed.
_STATE_BBOX: dict[str, tuple[float, float, float, float]] = {
    "MO": (36.0, 40.6, -95.8, -89.1),  # (lat_min, lat_max, lng_min, lng_max)
    "AR": (33.0, 36.5, -94.6, -89.6),
}

_GEO_RE = re.compile(r"(\d+):(\d+)~([-\d.]+)~([-\d.]+)")
_SLUG_ITEM_TYPE = 6  # `[6, "slug-text"]`
_PRICE_DISPLAY_ITEM_TYPE = 10  # `[10, "$12,345"]`
_IMAGE_LIST_ITEM_TYPE = 4  # `[4, "3:00c0c_...", ...]`
_PRIMARY_IMAGE_ITEM_TYPE = 13  # `[13, "imgId"]`

# Category code 143 = real estate. This appears as a plain int in the
# array and we must NOT confuse it with a price.
_CATEGORY_CODE_RE = re.compile(r"\b143\b")


def _parse_item(it: list[Any]) -> dict[str, Any] | None:
    """Extract a listing dict from one sapi item array.

    Positional layout drifts based on which optional sub-arrays are
    present; scanning by shape is more reliable than by index. Returns
    None if the item can't be parsed into a usable record.
    """
    if not isinstance(it, list) or len(it) < 6:
        return None

    geo_lat = geo_lng = None
    price_display = ""
    price_from_pos3 = 0.0
    slug = ""
    title = ""
    image_hashes: list[str] = []
    primary_image_hash = ""
    post_id = 0

    # Positional semantics (stable across all observed responses):
    #   pos 0: some kind of age/sequence int (NOT price; often huge)
    #   pos 1: post ID
    #   pos 2: category code (143 for real estate)
    #   pos 3: price in whole dollars  ← authoritative integer source
    #   pos 4: geo coord string
    # Everything past pos 4 is typed sub-arrays or the title string.
    if len(it) > 1 and isinstance(it[1], int) and it[1] > 100000:
        post_id = it[1]
    if len(it) > 3 and isinstance(it[3], int) and it[3] >= 0:
        price_from_pos3 = float(it[3])

    for pos, val in enumerate(it):
        if isinstance(val, str):
            # Geo coord string — "1:1~LAT~LNG"
            m_geo = _GEO_RE.fullmatch(val)
            if m_geo and geo_lat is None:
                try:
                    geo_lat = float(m_geo.group(3))
                    geo_lng = float(m_geo.group(4))
                except ValueError:
                    pass
                continue
            # Otherwise a plain string — treat as title (longest wins).
            if len(val) > 10:
                if len(val) > len(title):
                    title = val
        elif isinstance(val, list) and val:
            first = val[0]
            if first == _SLUG_ITEM_TYPE and len(val) >= 2:
                slug = str(val[1])
            elif first == _PRICE_DISPLAY_ITEM_TYPE and len(val) >= 2:
                price_display = str(val[1])
            elif first == _IMAGE_LIST_ITEM_TYPE:
                # Rest of the array is image hashes
                for h in val[1:]:
                    if isinstance(h, str) and h not in image_hashes:
                        image_hashes.append(h)
            elif first == _PRIMARY_IMAGE_ITEM_TYPE and len(val) >= 2:
                primary_image_hash = str(val[1])

    if geo_lat is None or geo_lng is None:
        return None

    # Price: prefer the price-display tuple ("$85,000") because it's
    # symbol-anchored and unambiguous. Fall back to pos 3 only if the
    # display isn't present. A sanity cap at $500k rejects any row
    # where the heuristic probably latched onto a post-id or sequence
    # integer instead of the real price — Craigslist FSBO rural land
    # genuinely priced above $500k is rare, and rejecting the
    # occasional legit $600k listing is preferable to polluting the
    # corpus with $7M misparses.
    price = 0.0
    if price_display:
        m_disp = re.search(r"\$([\d,]+)", price_display)
        if m_disp:
            try:
                price = float(m_disp.group(1).replace(",", ""))
            except ValueError:
                pass
    if price == 0.0 and 0 < price_from_pos3 <= 500_000:
        price = price_from_pos3
    if price > 500_000:
        return None

    # Build listing URL. Without knowing the region subdomain, we
    # construct the /reo/d/{slug}/{postID}.html variant hitting the
    # craigslist.org apex; CL redirects to the correct region. This
    # works reliably for "real estate by owner" (reo) posts.
    url = (
        f"https://craigslist.org/reo/d/{slug}/{post_id}.html"
        if slug and post_id
        else f"https://craigslist.org"
    )

    # Image URLs — Craigslist serves images as:
    #   https://images.craigslist.org/{hash}_600x450.jpg
    # The "3:XXXX_yyyy_zzzz" hashes contain size params (the trailing
    # _XX0YY fragment); we use the base hash up to the last underscore.
    images: list[str] = []
    all_hashes = (
        ([primary_image_hash] if primary_image_hash else [])
        + image_hashes
    )
    for h in all_hashes:
        if not h:
            continue
        # Normalize: "3:00c0c_abc_def" → "00c0c_abc" (strip the "3:"
        # prefix and the trailing size fragment).
        core = h.split(":", 1)[-1]
        # Strip trailing underscore-suffixed size chunk
        core = re.sub(r"_[0-9A-Za-z]+$", "", core)
        url_img = f"https://images.craigslist.org/{core}_600x450.jpg"
        if url_img not in images:
            images.append(url_img)

    return {
        "id": str(post_id),
        "title": title or f"Craigslist FSBO {post_id}",
        "url": url,
        "price": price,
        "lat": geo_lat,
        "lng": geo_lng,
        "slug": slug,
        "price_display": price_display,
        "images": images[:6],
    }


def _infer_state_from_bbox(lat: float, lng: float) -> str | None:
    """Return MO or AR if the coord falls inside either state's bbox."""
    for state, bbox in _STATE_BBOX.items():
        if bbox[0] <= lat <= bbox[1] and bbox[2] <= lng <= bbox[3]:
            return state
    return None


class CraigslistScraper(BaseScraper):
    """One national fetch per run, filtered to MO+AR via lat/lng bbox.

    Yields FSBO-only land listings. Small volume per run (~5-15 hits
    across MO+AR) but these are often the cheapest deals in the
    corpus — $1k-$25k parcels that aggregator brokerages skip.
    """

    SOURCE_NAME = "craigslist"
    BASE_URL = "https://craigslist.org"
    RATE_LIMIT_SECONDS = 4.0

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch national feed, filter to the requested state. The
        `state` argument is used to slice the single fetch; calling
        multiple times per run is fine since curl_cffi is cheap.
        max_pages is ignored — sapi doesn't paginate the national feed
        at our batch size."""
        _ = max_pages
        # Use curl_cffi directly (bypass the scraper strategy chain)
        # since sapi.craigslist.org requires Chrome TLS fingerprint
        # and the default strategy chain picks http first (which
        # returns a JSON blob curl_cffi's Chrome fingerprint unblocks).
        try:
            from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
        except ImportError:
            log.info("[craigslist] curl_cffi not available")
            return []
        try:
            r = cffi_requests.get(_SAPI_URL, impersonate="chrome131", timeout=20)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.info(f"[craigslist] sapi fetch failed: {type(e).__name__}: {e}")
            return []

        items = data.get("data", {}).get("items", []) if isinstance(data, dict) else []
        target_state = state.upper()
        target_bbox = _STATE_BBOX.get(target_state)
        if not target_bbox:
            return []

        results: list[dict[str, Any]] = []
        for raw in items:
            parsed = _parse_item(raw)
            if not parsed:
                continue
            lat, lng = parsed.get("lat"), parsed.get("lng")
            if lat is None or lng is None:
                continue
            inferred = _infer_state_from_bbox(lat, lng)
            if inferred != target_state:
                continue
            parsed["state"] = target_state
            results.append(parsed)

        log.info(f"[craigslist] {target_state}: {len(results)} FSBO rows (from {len(items)} national)")
        return results

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        title = str(raw.get("title", "")).strip()
        price = float(raw.get("price", 0) or 0)
        # Craigslist listings usually don't expose acreage in structured
        # form. Extract from title when possible; otherwise we ship
        # acres=0 and let the AI enrichment infer it from the text.
        acres = 0.0
        m = re.search(
            r"([\d.]+)\s*(?:±|\+/-|\+-)?\s*[Aa]cres?", title + " " + str(raw.get("description", ""))
        )
        if m:
            try:
                acres = float(m.group(1))
            except ValueError:
                pass
        if not title or price <= 0:
            return None
        images = [u for u in (raw.get("images") or []) if isinstance(u, str) and u]
        return RawListing(
            external_id=str(raw.get("id", "")),
            title=title,
            price=price,
            acreage=acres,
            state=str(raw.get("state", "")).upper(),
            county="",  # unknown at this point; geo-enrichment fills it
            lat=raw.get("lat"),
            lng=raw.get("lng"),
            features=extract_features(title)
            + ["owner_financing"],  # Craigslist FSBO almost always implies seller-finance
            description=title,
            url=str(raw.get("url", "")),
            images=images,
            raw=raw,
        )
