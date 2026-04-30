"""Mossy Oak Properties scraper — https://www.mossyoakproperties.com

Hunting / recreational / timberland-specialist brokerage with strong
Ozark + Delta coverage. Key hidden-gem characteristics vs LandWatch:

  - Brokered primarily by regional franchise offices; many listings
    never make it to the big aggregators
  - Rural-only focus — filters out metro / subdivision noise that
    clutters LandWatch results
  - Heavy overlap with USDA/FSA + timber-company inventory

URL structure (verified 2026-04-22):
    /land-for-sale/{state}/     → server-rendered list of ~72 cards
    /property/{slug}/{id}/      → detail pages

The search page is PURE server-rendered HTML (curl_cffi with Chrome
TLS impersonation is enough — no Playwright required). Each card is
a `.rs-listing-card.rs-listing-item` div with:
  - `data-listing-id="96522"` — stable numeric id for our `id` field
  - `data-lat="35.507334"` / `data-lng="-91.995259"` — ship-ready
    coordinates, no PLSS / Nominatim lookup needed
  - Multiple `<img data-src="...">` thumbnails from the realstack.com
    CDN (Mossy Oak uses realstack as their image host)
  - Title text, "County County, ST" label, description preview,
    and "NNN± Acres | $Y" summary line

One fetch per state returns the whole inventory in a single render.
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

import raw_archive
from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.mossy_oak")

_PRICE_RE = re.compile(r"\$([\d,]+)(?:\.\d+)?")
# Mossy Oak uses "NNN± Acres" on summary lines (± in various
# forms including "+-", "+/-", or just a number alone).
_ACRES_RE = re.compile(r"([\d.,]+)\s*(?:±|\+/-|\+-)?\s*[Aa]cres?", re.IGNORECASE)
_COUNTY_RE = re.compile(r"([A-Z][A-Za-z\s\-]+?)\s+[Cc]ounty", re.MULTILINE)
_STATE_RE = re.compile(r",\s*([A-Z]{2})\b")


def parse_mossy_oak_html(html: str, state: str) -> list[dict[str, Any]]:
    """Parse a Mossy Oak `/land-for-sale/{state}/` page into raw
    listing dicts. Returns one dict per `.rs-listing-item` card with
    lat/lng already populated from the card's `data-*` attributes.
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    results: list[dict[str, Any]] = []
    for card in soup.select("div.rs-listing-card.rs-listing-item"):
        listing_id = card.get("data-listing-id", "").strip()
        if not listing_id:
            continue

        # Link — first anchor with /property/.../id/
        href = ""
        anchor = card.select_one(
            f'a[href*="/property/"][href*="/{listing_id}/"]'
        )
        if anchor:
            href = anchor.get("href", "").strip()
        if not href:
            continue
        url = href if href.startswith("http") else f"https://www.mossyoakproperties.com{href}"

        # Title — the anchor's `title` attribute is cleaner than its text
        # (the text often says "Click to View More Photos" / "View Property")
        title = (anchor.get("title") or "").strip() if anchor else ""
        if not title:
            # Fall back to h2/h3 inside the card
            title_el = card.select_one("h2, h3, .listing-title")
            title = title_el.get_text(" ", strip=True) if title_el else ""
        title = re.sub(r"^\d+/\d+\s+", "", title)  # strip gallery "N/M" prefix

        # Coordinates — data attributes on the wrapper
        lat = lng = None
        try:
            raw_lat = card.get("data-lat", "").strip()
            raw_lng = card.get("data-lng", "").strip()
            if raw_lat and raw_lng:
                lat = float(raw_lat)
                lng = float(raw_lng)
                # Some cards have 0,0 placeholders — treat as missing
                if lat == 0 and lng == 0:
                    lat = lng = None
        except ValueError:
            lat = lng = None

        # Card text — title + county label + description + "NNN± Acres | $Y"
        # summary. Price and acres live in that final summary.
        card_text = card.get_text(" ", strip=True)

        price = 0.0
        m_price = _PRICE_RE.search(card_text)
        if m_price:
            try:
                price = float(m_price.group(1).replace(",", ""))
            except ValueError:
                pass

        acres = 0.0
        m_acres = _ACRES_RE.search(card_text)
        if m_acres:
            try:
                acres = float(m_acres.group(1).replace(",", ""))
            except ValueError:
                pass

        # County + state — Mossy Oak cards render "Cleburne County, AR" as
        # a label below the title. Pull the first such match.
        county = ""
        m_county = _COUNTY_RE.search(card_text)
        if m_county:
            raw_county = m_county.group(1).strip()
            county = (
                raw_county
                if raw_county.lower().endswith("county")
                else f"{raw_county} County"
            )
        m_state = _STATE_RE.search(card_text)
        listing_state = (m_state.group(1) if m_state else state).upper()

        # Images — `<img data-src="realstack.com/...">` per thumbnail.
        # First image is the primary (in card-header card-media); others
        # are carousel photos in the same card, hidden until hover.
        images: list[str] = []
        seen_img: set[str] = set()
        for img in card.select("img[data-src]"):
            src = (img.get("data-src") or "").strip()
            if not src or src.startswith("data:") or src in seen_img:
                continue
            seen_img.add(src)
            images.append(src)
        # Also include any `src=` attributes we might have missed
        for img in card.select("img[src]"):
            src = (img.get("src") or "").strip()
            if (
                src
                and not src.startswith("data:")
                and "realstack.com" in src
                and src not in seen_img
            ):
                seen_img.add(src)
                images.append(src)

        # Description — strip the nav/gallery noise, keep the blurb.
        desc_el = card.select_one(".card-body, .listing-description, .rs-card-body")
        description = desc_el.get_text(" ", strip=True) if desc_el else card_text
        # Trim trailing "View Property" call-to-action
        description = re.sub(
            r"\s*(?:View Property|Click to View More Photos).*$",
            "",
            description,
        ).strip()[:1500]

        if price <= 0 and acres <= 0:
            # Cards without both are usually "call for price" — skip
            # rather than pollute the scored list with zero-price rows.
            continue

        results.append(
            {
                "id": listing_id,
                "title": title or f"Mossy Oak listing {listing_id}",
                "url": url,
                "price": price,
                "acres": acres,
                "lat": lat,
                "lng": lng,
                "state": listing_state,
                "county": county,
                "description": description,
                "images": images[:12],  # cap for JSON size
                "listingStatus": "active",
            }
        )
    return results


class MossyOakScraper(BaseScraper):
    """Fetch Mossy Oak Properties state land-for-sale pages. Plain
    server-rendered HTML — no Playwright required; curl_cffi with a
    Chrome TLS fingerprint handles it in ~0.8s.
    """

    SOURCE_NAME = "mossy_oak"
    BASE_URL = "https://www.mossyoakproperties.com"
    RATE_LIMIT_SECONDS = 2.5

    def _state_url(self, state: str) -> str:
        # Pulled from the shared STATE_SLUGS map — previously only
        # AR/MO were inlined here, which silently zeroed every other
        # state (TX caught it during the 2026-04-29 Austin pivot).
        from states import STATE_SLUGS

        state_slug = STATE_SLUGS.get(state.upper())
        if not state_slug:
            return ""
        return f"{self.BASE_URL}/land-for-sale/{state_slug}/"

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        _ = max_pages  # intentionally unused — Mossy Oak returns all in one render
        url = self._state_url(state)
        if not url:
            return []
        try:
            result = self.fetch_page(url)
        except Exception as e:
            log.info(f"[mossy_oak] fetch failed for {url}: {e}")
            return []
        # Archive raw HTML before parsing (durability layer).
        raw_archive.archive(
            "mossy_oak",
            f"state-{state.lower()}",
            result.content,
            ext="html",
        )
        items = parse_mossy_oak_html(result.content, state)
        log.info(
            f"[mossy_oak] {state}: {len(items)} listings "
            f"(via {result.strategy_name})"
        )
        return items

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        title = str(raw.get("title", "")).strip()
        price = float(raw.get("price", 0) or 0)
        acres = float(raw.get("acres", 0) or 0)
        if not title or (price <= 0 and acres <= 0):
            return None
        description = str(raw.get("description", ""))[:1500]
        images = [u for u in (raw.get("images") or []) if isinstance(u, str) and u]
        raw.setdefault("listingStatus", "active")
        return RawListing(
            external_id=str(raw.get("id", "")),
            title=title,
            price=price,
            acreage=acres,
            state=str(raw.get("state", "")).upper(),
            county=str(raw.get("county", "")),
            lat=raw.get("lat"),
            lng=raw.get("lng"),
            features=extract_features(f"{title} {description}"),
            description=description,
            url=str(raw.get("url", "")),
            images=images,
            raw=raw,
        )
