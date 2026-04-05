"""LandWatch scraper — https://www.landwatch.com"""

from __future__ import annotations

import re
from typing import Any

from .base import BaseScraper, RawListing

from logger import get_logger

log = get_logger("scraper.landwatch")


FEATURE_KEYWORDS: dict[str, list[str]] = {
    "water_well": ["water well", "drilled well", "domestic well"],
    "water_creek": ["creek", "stream", "river", "year-round water"],
    "water_pond": ["pond", "lake", "stock tank"],
    "road_paved": ["paved road", "paved access", "highway frontage"],
    "road_dirt": ["dirt road", "gravel road", "county road", "forest road"],
    "electric": ["electricity", "electric", "power to", "utilities"],
    "septic": ["septic", "leach field"],
    "structures": ["cabin", "house", "barn", "shop", "building"],
    "timber": ["timber", "pine", "fir", "hardwood", "forest"],
    "pasture": ["pasture", "meadow", "grassland", "hay"],
    "hunting": ["hunting", "elk", "deer", "turkey", "game"],
    "mineral_rights": ["mineral rights", "minerals included"],
    "no_hoa": ["no hoa", "no covenants", "no restrictions", "unrestricted"],
    "off_grid_ready": ["off-grid", "off grid", "solar", "self-sufficient"],
    "owner_financing": [
        "owner financing",
        "owner will carry",
        "seller financing",
        "land contract",
    ],
}


def extract_features(text: str) -> list[str]:
    """Extract feature tags from listing description/title."""
    text_lower = text.lower()
    features = []
    for feature, keywords in FEATURE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            features.append(feature)
    return features


class LandWatchScraper(BaseScraper):
    """Scraper for LandWatch.com land listings."""

    SOURCE_NAME = "landwatch"
    BASE_URL = "https://www.landwatch.com"
    RATE_LIMIT_SECONDS = 2.5

    def get_page_urls(self, state: str, max_pages: int = 5) -> list[str]:
        """Return search URLs for AI fallback."""
        state_lower = state.lower()
        return [
            f"{self.BASE_URL}/land-for-sale/{state_lower}-land?page={p}&type=Land&pricemin=1000&acresmin=5"
            for p in range(1, max_pages + 1)
        ]

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch land listings for a state via LandWatch search."""
        results = []
        state_lower = state.lower()

        for page in range(1, max_pages + 1):
            url = f"{self.BASE_URL}/land-for-sale/{state_lower}-land"
            params: dict[str, Any] = {
                "page": page,
                "type": "Land",
                "pricemin": 1000,
                "acresmin": 5,
            }
            try:
                response = self.get(url, params=params)
                soup = self.parse_html(response.text)

                # Parse listing cards from the page
                cards = soup.select(
                    "[data-testid='property-card'], .property-card, article.listing"
                )
                if not cards:
                    # Try JSON-LD structured data
                    import json

                    scripts = soup.find_all("script", type="application/ld+json")
                    for script in scripts:
                        try:
                            data = json.loads(script.string or "")
                            if isinstance(data, list):
                                results.extend(data)
                            elif (
                                isinstance(data, dict)
                                and data.get("@type") == "ItemList"
                            ):
                                results.extend(data.get("itemListElement", []))
                        except (json.JSONDecodeError, AttributeError):
                            pass
                    break

                for card in cards:
                    listing = self._extract_card_data(card, state)
                    if listing:
                        results.append(listing)

            except Exception as e:
                log.info(f"[landwatch] Page {page} error for {state}: {e}")
                break

        return results

    def _extract_card_data(self, card: Any, state: str) -> dict[str, Any] | None:
        """Extract data from a listing card element."""
        try:
            title_el = card.select_one(
                "h2, h3, .property-title, [data-testid='property-title']"
            )
            price_el = card.select_one(".price, [data-testid='price'], .listing-price")
            acres_el = card.select_one(".acres, [data-testid='acres'], .acreage")
            link_el = card.select_one("a[href]")
            location_el = card.select_one(
                ".location, .county, [data-testid='location']"
            )

            if not (title_el and price_el and link_el):
                return None

            price_text = re.sub(r"[^\d.]", "", price_el.get_text())
            acres_text = re.sub(r"[^\d.]", "", acres_el.get_text() if acres_el else "0")

            href = link_el.get("href", "")
            listing_id = re.search(r"/(\d+)/?$", href)

            return {
                "id": listing_id.group(1) if listing_id else href,
                "title": title_el.get_text(strip=True),
                "price": float(price_text) if price_text else 0,
                "acres": float(acres_text) if acres_text else 0,
                "state": state,
                "county": location_el.get_text(strip=True) if location_el else "",
                "url": f"{self.BASE_URL}{href}" if href.startswith("/") else href,
                "description": card.get_text(separator=" ", strip=True)[:500],
            }
        except (AttributeError, ValueError):
            return None

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a raw listing dict into a RawListing."""
        try:
            price = float(raw.get("price", 0))
            acres = float(raw.get("acres", 0))

            if price <= 0 or acres <= 0:
                return None

            description = raw.get("description", "")
            title = raw.get("title", "")
            combined_text = f"{title} {description}"

            return RawListing(
                external_id=str(raw.get("id", "")),
                title=title or f"Land in {raw.get('state', '')}",
                price=price,
                acreage=acres,
                state=raw.get("state", ""),
                county=raw.get("county", ""),
                lat=raw.get("lat"),
                lng=raw.get("lng"),
                features=extract_features(combined_text),
                description=description,
                days_on_market=raw.get("daysOnMarket"),
                url=raw.get("url", ""),
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
