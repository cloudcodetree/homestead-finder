"""Lands of America scraper — https://www.landsofamerica.com"""
from __future__ import annotations

import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features


class LandsOfAmericaScraper(BaseScraper):
    """Scraper for LandsOfAmerica.com property listings."""

    SOURCE_NAME = "lands_of_america"
    BASE_URL = "https://www.landsofamerica.com"
    RATE_LIMIT_SECONDS = 2.0

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch land listings for a state."""
        results = []
        for page in range(1, max_pages + 1):
            url = f"{self.BASE_URL}/property/search/"
            params = {
                "st": state,
                "t": "0",   # Type: land
                "page": page,
            }
            try:
                response = self.get(url, params=params)
                soup = self.parse_html(response.text)

                cards = soup.select(".propCard, .property-card, [class*='PropertyCard']")
                if not cards:
                    break

                for card in cards:
                    data = self._parse_card(card, state)
                    if data:
                        results.append(data)
            except Exception as e:
                print(f"  [lands_of_america] Error for {state} page {page}: {e}")
                break

        return results

    def _parse_card(self, card: Any, state: str) -> dict[str, Any] | None:
        """Extract listing data from a card element."""
        try:
            title_el = card.select_one("h2, h3, .propTitle, .property-name")
            price_el = card.select_one(".price, .propPrice, [class*='price']")
            acres_el = card.select_one(".acres, .acreage, [class*='acres']")
            link_el = card.select_one("a[href*='/property/']")

            if not (title_el and link_el):
                return None

            price_text = re.sub(r"[^\d.]", "", price_el.get_text()) if price_el else "0"
            acres_text = re.sub(r"[^\d.]", "", acres_el.get_text()) if acres_el else "0"

            href = link_el.get("href", "")
            prop_id = re.search(r"/property/(\d+)", href)

            return {
                "id": prop_id.group(1) if prop_id else href,
                "title": title_el.get_text(strip=True),
                "price": float(price_text) if price_text else 0,
                "acres": float(acres_text) if acres_text else 0,
                "state": state,
                "county": "",
                "url": href if href.startswith("http") else f"{self.BASE_URL}{href}",
                "description": card.get_text(separator=" ", strip=True)[:500],
            }
        except (AttributeError, ValueError):
            return None

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse raw listing data into a RawListing."""
        try:
            price = float(raw.get("price", 0))
            acres = float(raw.get("acres", 0))
            if price <= 0 or acres <= 0:
                return None

            description = raw.get("description", "")
            title = raw.get("title", "")

            return RawListing(
                external_id=str(raw.get("id", "")),
                title=title,
                price=price,
                acreage=acres,
                state=raw.get("state", ""),
                county=raw.get("county", ""),
                features=extract_features(f"{title} {description}"),
                description=description,
                url=raw.get("url", ""),
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
