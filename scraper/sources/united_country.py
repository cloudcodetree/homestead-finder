"""United Country Real Estate scraper — https://www.unitedcountry.com

UCRE is a rural/small-town-focused real estate franchise (~500 US
offices), with strong Ozark presence (Willow Springs MO, Mountain
Home AR, Ava MO, etc). Their land inventory tends to be:

  - Properties listed by local franchise offices that don't always
    flow to LandWatch / Land.com aggregators
  - Recreational / hunting / owner-finance land that matches the
    "hidden gem" homestead thesis
  - Heavy overlap with USDA/FSA and county-broker listings

URL structure (verified 2026-04-22):
    https://www.unitedcountry.com/landforsale/?state=AR
    → JavaScript-rendered search grid, ~25 results/page
    → card links to /properties/{state}/{slug}/{id}/
    → media URL: media.unitedcountry.com/uc-media/listings/pictures/{id}/...

The search page is a React SPA — plain HTTP returns an empty shell
(~121KB with no listing data). Playwright is required. One fetch
per state, no pagination needed for the MVP (the grid loads 100-
300+ results in a single render).
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.united_country")


_COUNTY_RE = re.compile(r"([A-Z][A-Za-z\s\-]+?)\s+[Cc]ounty", re.MULTILINE)
_PRICE_RE = re.compile(r"\$([\d,]+)(?:\.\d+)?")
_ACRES_RE = re.compile(r"([\d.]+)\s*(?:\+/-\s*)?[Aa]cres?", re.IGNORECASE)
# Listing URL shape: /properties/{state}/{slug}/{numeric-id}/
_LISTING_URL_RE = re.compile(r"/properties/([a-z]{2})/[^/]+/(\d+)/?")


def parse_ucre_html(html: str, state: str) -> list[dict[str, Any]]:
    """Parse UCRE search-results HTML into raw listing dicts.

    Each result card is a `div.results-item` containing:
      - `a.stretched-link` with href=/properties/{state}/{slug}/{id}/
      - `img` with the primary CDN photo URL
      - `.tag_status` — "Active", "Pending", "Sold"
      - `.tag_city_st` — "Bentonville, AR"
      - `h3.h3-featured` — listing title
      - `.price_tag` — "$21,606,487"
      - `.description_tag` — blurb, often contains acreage
      - `.listingID_...` — local MLS id (kept as metadata; our
        `id` field uses UCRE's site id for stable URLs)
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for card in soup.select("div.results-item"):
        anchor = card.select_one("a.stretched-link[href*='/properties/']")
        if not anchor:
            continue
        href = anchor.get("href", "").strip()
        m = _LISTING_URL_RE.search(href)
        if not m:
            continue
        listing_state_code = m.group(1).upper()
        listing_id = m.group(2)
        if listing_id in seen_ids:
            continue
        seen_ids.add(listing_id)

        url = href if href.startswith("http") else f"https://www.unitedcountry.com{href}"

        # Status — map to our vocabulary (sold/pending gets hidden by
        # default via the "hide inactive" filter toggle)
        status_el = card.select_one(".tag_status")
        status_raw = (status_el.get_text(strip=True) if status_el else "").lower()
        if "sold" in status_raw:
            listing_status = "expired"
        elif "pending" in status_raw or "contract" in status_raw:
            listing_status = "pending"
        else:
            listing_status = "active"

        # Title
        title_el = card.select_one("h3.h3-featured, h3")
        title = title_el.get_text(" ", strip=True) if title_el else ""

        # Price — strip formatting; skip cards with no published price
        price = 0.0
        price_el = card.select_one(".price_tag")
        if price_el:
            m_price = _PRICE_RE.search(price_el.get_text())
            if m_price:
                try:
                    price = float(m_price.group(1).replace(",", ""))
                except ValueError:
                    pass

        # Description — contains acreage mention in the common case
        desc_el = card.select_one(".description_tag")
        description = desc_el.get_text(" ", strip=True) if desc_el else ""
        # Clean out the "more..." trailer
        description = re.sub(r"\s*more\.\.\..*$", "", description).strip()

        # Acreage — search title first (often authoritative: "58.11 acres"),
        # then description (fallback).
        acres = 0.0
        for text in (title, description):
            am = _ACRES_RE.search(text)
            if am:
                try:
                    acres = float(am.group(1))
                    break
                except ValueError:
                    continue

        # Primary image — <img> inside header. Normalize `?w=400` → `?w=990`
        # so we get hero-sized images consistent with LandWatch.
        images: list[str] = []
        for img in card.select("img"):
            src = (img.get("src") or img.get("data-src") or "").strip()
            if not src or src.startswith("data:"):
                continue
            # Bump display width to match our carousel target
            src = re.sub(r"\?w=\d+", "?w=990", src)
            if src not in images:
                images.append(src)

        # City/State pill — format "City, ST\n\n  (extra padding)"
        city = ""
        city_el = card.select_one(".tag_city_st")
        if city_el:
            raw = city_el.get_text(" ", strip=True)
            # Extract "City" from "City, ST"
            m_city = re.match(r"([^,]+),\s*([A-Z]{2})", raw)
            if m_city:
                city = m_city.group(1).strip()

        # County — not on the card; scrape title/description heuristically.
        # Title often reads "Nearby-town, County, AR — Land For Sale" or
        # includes "X acres in Y County". Fall back to empty; geo-enrich
        # will backfill county from lat/lng later.
        county_match = _COUNTY_RE.search(f"{title} {description}")
        county = (
            f"{county_match.group(1).strip()} County" if county_match else ""
        )

        if price <= 0 and acres <= 0:
            # Skip cards we can't score at all — no price AND no acres
            # leaves us with nothing actionable. Usually these are
            # "call for details" private listings.
            continue

        results.append(
            {
                "id": listing_id,
                "title": title or f"UCRE listing {listing_id}",
                "url": url,
                "price": price,
                "acres": acres,
                "state": listing_state_code or state.upper(),
                "county": county,
                "city": city,
                "description": description,
                "images": images,
                "listingStatus": listing_status,
            }
        )
    return results


class UnitedCountryScraper(BaseScraper):
    """Scrape UCRE's state-level land search pages via Playwright.

    One request per state, JS-rendered, returns 100-300+ results per
    call. No pagination needed at the MVP scale; UCRE's search grid
    renders everything up front unless a regional filter is applied.
    """

    SOURCE_NAME = "united_country"
    BASE_URL = "https://www.unitedcountry.com"
    RATE_LIMIT_SECONDS = 4.0

    def _state_url(self, state: str) -> str:
        return f"{self.BASE_URL}/landforsale/?state={state.upper()}"

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch all land listings for a state in one shot (UCRE's grid
        isn't paginated at the URL level for the MVP). `max_pages` is
        ignored — preserved for BaseScraper compatibility."""
        _ = max_pages  # intentionally unused
        url = self._state_url(state)
        try:
            result = self.fetch_page(url)
        except Exception as e:
            log.info(f"[united_country] fetch failed for {url}: {e}")
            return []
        # Archive raw HTML before parsing (durability layer).
        from raw_archive import archive as _archive

        _archive("united_country", f"state-{state.lower()}", result.content, ext="html")
        items = parse_ucre_html(result.content, state)
        log.info(
            f"[united_country] {state}: {len(items)} listings parsed "
            f"(via {result.strategy_name})"
        )
        return items

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        title = str(raw.get("title", "")).strip()
        price = float(raw.get("price", 0) or 0)
        acres = float(raw.get("acres", 0) or 0)
        # Allow acres=0 only if price is non-trivial (town lots etc.)
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
            features=extract_features(f"{title} {description}"),
            description=description,
            url=str(raw.get("url", "")),
            images=images,
            raw=raw,
        )
