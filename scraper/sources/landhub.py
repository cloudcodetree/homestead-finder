"""LandHub.com scraper — https://www.landhub.com

LandHub is a small-brokerage + FSBO-leaning aggregator that sits well
outside the Land.com / LandWatch family. Inventory overlap with
LandWatch is low (confirmed 2026-04-22): MO carries ~1,666 active
rows, AR ~686, and a sampled dozen titles don't show up in our
LandWatch or Mossy Oak corpus.

Scrape shape:
  - Search URL: /land-for-sale/{state-slug}/?page={N}
  - The page is a Next.js SSR render — the entire visible listing set
    for the page ships as JSON inside
    `<script id="__NEXT_DATA__" type="application/json">`
  - 12 rows per page on `props.pageProps.dataFromServer`
  - Each row is already structured with id, title, price, acres,
    latitude, longitude, county, city, zip, property_type, features,
    image list, and timestamps — no HTML parsing needed

Fetch: plain HTTP works (no Cloudflare or TLS wall), confirmed with
User-Agent alone.

Per-listing image URL reconstruction:
  `image` field is a JSON-encoded list of filenames like
  `"57600533-0.webp"`. Full URL is:
    https://img.landhub.com/property/{id}/{filename}

Detail URL:
  `/property/{id}` 301-redirects to the canonical slug form, so we
  ship the short id-only URL and let the CDN canonicalize.
"""

from __future__ import annotations

import json
import re
from typing import Any

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.landhub")

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

# Image filename allowlist — matches {digits}-{digits}.{ext} shape that
# LandHub uses ("57600533-0.webp"), plus a generic fallback. Rejects
# anything with a path separator, query string, or backslash. Paired
# with an integer-only listing_id check upstream to prevent URL path
# traversal via the CDN.
_VALID_IMAGE_FILENAME = re.compile(r"[A-Za-z0-9_.\-]+")

_STATE_SLUGS = {
    "MO": "missouri",
    "AR": "arkansas",
}


def _parse_json_list(val: Any) -> list[str]:
    """LandHub encodes list fields (image, features, property_type) as
    JSON strings. Normalize to a plain list[str] — tolerate None, bad
    JSON, or already-parsed list."""
    if not val:
        return []
    if isinstance(val, list):
        return [str(x) for x in val if x]
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if x]
        except (json.JSONDecodeError, ValueError):
            return []
    return []


def _extract_listings(html: str) -> list[dict[str, Any]]:
    """Pull the listing array out of the Next.js SSR payload."""
    m = _NEXT_DATA_RE.search(html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except (json.JSONDecodeError, ValueError):
        return []
    page_props = data.get("props", {}).get("pageProps", {})
    rows = page_props.get("dataFromServer")
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


class LandHubScraper(BaseScraper):
    """LandHub.com MO+AR scraper. Single-state page fetch per page
    iteration; default 5 pages = 60 listings per state (pilot-scale).
    Raise MAX_PAGES_PER_SOURCE env var to pull the full ~1.6k MO
    inventory when needed."""

    SOURCE_NAME = "landhub"
    BASE_URL = "https://www.landhub.com"
    RATE_LIMIT_SECONDS = 2.0

    def _page_url(self, state: str, page: int) -> str:
        slug = _STATE_SLUGS.get(state.upper())
        if not slug:
            return ""
        # The /land-for-sale/{slug}/ form works for page 1; explicit
        # ?page= works for all pages including page 1.
        return f"{self.BASE_URL}/land-for-sale/{slug}/?page={page}"

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        seen_ids: set[int] = set()
        for page in range(1, max(1, max_pages) + 1):
            url = self._page_url(state, page)
            if not url:
                return []
            try:
                result = self.fetch_page(url)
            except Exception as e:
                log.info(f"[landhub] {state} page {page} fetch failed: {e}")
                break
            page_rows = _extract_listings(result.content)
            if not page_rows:
                log.info(
                    f"[landhub] {state} page {page}: no rows parsed "
                    f"(strategy={result.strategy_name}); stopping pagination"
                )
                break
            fresh = 0
            for r in page_rows:
                rid = r.get("id")
                if rid is None or rid in seen_ids:
                    continue
                seen_ids.add(rid)
                rows.append(r)
                fresh += 1
            if fresh == 0:
                # Same rows as prior page — pagination has exhausted or
                # the site is echoing page 1 on out-of-range requests.
                break
        log.info(f"[landhub] {state}: {len(rows)} listings over {page} pages")
        return rows

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        try:
            listing_id = raw.get("id")
            if listing_id is None:
                return None
            # Require integer-shaped id. Prevents a malicious site row
            # from producing an attacker-controlled URL path or CDN
            # image URL via e.g. `"id": "../admin"`.
            if isinstance(listing_id, str) and listing_id.isdigit():
                listing_id = int(listing_id)
            if not isinstance(listing_id, int):
                return None
            title = str(raw.get("title") or "").strip()
            if not title:
                return None
            try:
                price = float(raw.get("price") or 0)
            except (TypeError, ValueError):
                price = 0.0
            try:
                acres = float(raw.get("acres") or 0)
            except (TypeError, ValueError):
                acres = 0.0
            # LandHub lets sellers enter $0 ("Call for Price") and $1
            # (auction placeholder). Both pollute the deal scorer's
            # $/acre math, so drop them — losing ~5% of rows.
            if price <= 1:
                return None
            if acres <= 0:
                return None

            # Coordinates ship as strings — tolerate None/empty.
            def _f(val: Any) -> float | None:
                try:
                    f = float(val)
                    return f if f != 0.0 else None
                except (TypeError, ValueError):
                    return None

            lat = _f(raw.get("latitude"))
            lng = _f(raw.get("longitude"))

            # LandHub `state` is the full name — derive the 2-letter
            # code by reverse-lookup on _STATE_SLUGS.
            state_full = str(raw.get("state") or "").strip().lower()
            state_code = next(
                (k for k, v in _STATE_SLUGS.items() if v == state_full),
                state_full[:2].upper() if state_full else "",
            )

            county = str(raw.get("county") or "").strip()

            # Image reconstruction — filename list → CDN URLs. listing_id
            # was integer-validated above, so only the filename needs an
            # allowlist here — block path separators, query strings, and
            # traversal sequences.
            image_files = _parse_json_list(raw.get("image"))
            images = [
                f"https://img.landhub.com/property/{listing_id}/{fn}"
                for fn in image_files
                if fn and _VALID_IMAGE_FILENAME.fullmatch(fn)
            ][:12]

            # Features — LandHub's tags (e.g. "Hwy-County Rd Frontage",
            # "Development Potential") are useful but not in our
            # controlled vocab, so we run them through extract_features
            # alongside the title for the rule-based tag inference, and
            # tack the raw site tags on the description instead.
            site_tags = _parse_json_list(raw.get("features"))
            property_types = _parse_json_list(raw.get("property_type"))

            description_bits = [title]
            if property_types:
                description_bits.append("Type: " + ", ".join(property_types))
            if site_tags:
                description_bits.append("Features: " + ", ".join(site_tags))
            address = raw.get("street_address") or raw.get("address")
            city = raw.get("city")
            zipcode = raw.get("zipcode")
            addr_parts = [
                str(p).strip()
                for p in (address, city, state_full.title(), zipcode)
                if p
            ]
            if addr_parts:
                description_bits.append("Address: " + ", ".join(addr_parts))
            description = " | ".join(description_bits)[:1500]

            # /property/{id} redirects to canonical slug URL.
            url = f"{self.BASE_URL}/property/{listing_id}"

            features = extract_features(f"{title} {description}")

            return RawListing(
                external_id=str(listing_id),
                title=title,
                price=price,
                acreage=acres,
                state=state_code,
                county=county,
                lat=lat,
                lng=lng,
                features=features,
                description=description,
                url=url,
                images=images,
                raw=raw,
            )
        except Exception as e:
            log.info(f"[landhub] parse error: {type(e).__name__}: {e}")
            return None
