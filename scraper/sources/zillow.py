"""Zillow land/lot scraper — rate-limited, use sparingly."""

from __future__ import annotations

import json
import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features

from logger import get_logger

log = get_logger("scraper.zillow")


class ZillowScraper(BaseScraper):
    """Scraper for Zillow land and lot listings."""

    SOURCE_NAME = "zillow"
    BASE_URL = "https://www.zillow.com"
    RATE_LIMIT_SECONDS = 5.0  # Zillow is aggressive about rate limiting

    def fetch(self, state: str, max_pages: int = 3) -> list[dict[str, Any]]:
        """Fetch land listings from Zillow search."""
        results = []

        # Zillow embeds search results as JSON in the page
        url = f"{self.BASE_URL}/{state.lower()}/land/"
        try:
            response = self.get(url, headers={"Accept": "text/html"})
            soup = self.parse_html(response.text)

            # Find the __NEXT_DATA__ JSON blob
            script = soup.find("script", id="__NEXT_DATA__")
            if not script or not script.string:
                return results

            data = json.loads(script.string)
            search_results = (
                data.get("props", {})
                .get("pageProps", {})
                .get("searchPageState", {})
                .get("cat1", {})
                .get("searchResults", {})
                .get("listResults", [])
            )

            for item in search_results:
                # Only land/lots
                if item.get("hdpData", {}).get("homeInfo", {}).get("homeType") in (
                    "LOT",
                    "LAND",
                ):
                    results.append(item)

        except Exception as e:
            log.info(f"[zillow] Error for {state}: {e}")

        return results

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a Zillow search result item."""
        try:
            home_info = raw.get("hdpData", {}).get("homeInfo", {})
            price = raw.get("price") or home_info.get("price", 0)
            if isinstance(price, str):
                price = float(re.sub(r"[^\d.]", "", price))

            lot_size = home_info.get("lotAreaValue", 0)
            lot_unit = home_info.get("lotAreaUnit", "sqft")
            if lot_unit == "sqft":
                acreage = lot_size / 43560
            else:
                acreage = float(lot_size)

            if float(price) <= 0 or acreage < 1:
                return None

            detail_url = raw.get("detailUrl", "")
            full_url = (
                detail_url
                if detail_url.startswith("http")
                else f"{self.BASE_URL}{detail_url}"
            )
            description = raw.get("statusText", "") + " " + raw.get("address", "")

            return RawListing(
                external_id=str(raw.get("zpid", raw.get("id", ""))),
                title=raw.get("address") or f"Land in {home_info.get('state', '')}",
                price=float(price),
                acreage=round(acreage, 2),
                state=home_info.get("state", ""),
                county="",
                lat=raw.get("latLong", {}).get("latitude"),
                lng=raw.get("latLong", {}).get("longitude"),
                features=extract_features(description),
                description=description,
                url=full_url,
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
