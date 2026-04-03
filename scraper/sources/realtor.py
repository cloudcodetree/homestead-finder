"""Realtor.com land scraper."""
from __future__ import annotations

import json
import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features


class RealtorScraper(BaseScraper):
    """Scraper for Realtor.com land listings."""

    SOURCE_NAME = "realtor"
    BASE_URL = "https://www.realtor.com"
    RATE_LIMIT_SECONDS = 3.0

    def fetch(self, state: str, max_pages: int = 3) -> list[dict[str, Any]]:
        """Fetch land listings from Realtor.com."""
        results = []

        url = f"{self.BASE_URL}/realestateandhomes-search/{state}_state/type-land"
        try:
            response = self.get(url)
            soup = self.parse_html(response.text)

            # Realtor.com embeds data in a bootstrap_data script tag
            for script in soup.find_all("script"):
                text = script.string or ""
                if "bootstrap_data" in text or '"listings"' in text:
                    match = re.search(r'"properties"\s*:\s*(\[.*?\])', text, re.DOTALL)
                    if match:
                        try:
                            listings = json.loads(match.group(1))
                            results.extend(listings)
                        except json.JSONDecodeError:
                            pass
                    break

        except Exception as e:
            print(f"  [realtor] Error for {state}: {e}")

        return results

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a Realtor.com listing."""
        try:
            price = raw.get("list_price", 0)
            lot_sqft = raw.get("lot_sqft", 0)
            acreage = lot_sqft / 43560 if lot_sqft else raw.get("lot_acres", 0)

            if not price or not acreage:
                return None

            location = raw.get("location", {})
            address = location.get("address", {})
            state = address.get("state_code", "")
            county = location.get("county", {}).get("name", "")
            description = raw.get("description", {}).get("text", "")

            listing_id = raw.get("property_id", raw.get("listing_id", ""))
            url = f"{self.BASE_URL}/realestateandhomes-detail/{listing_id}"

            return RawListing(
                external_id=str(listing_id),
                title=raw.get("list_price_last_change_amount") or f"{round(acreage)} Acres in {county}, {state}",
                price=float(price),
                acreage=round(float(acreage), 2),
                state=state,
                county=county,
                lat=location.get("address", {}).get("coordinate", {}).get("lat"),
                lng=location.get("address", {}).get("coordinate", {}).get("lon"),
                features=extract_features(description),
                description=description,
                url=url,
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
