"""Auction site scraper — Hubzu, Auction.com, etc."""

from __future__ import annotations

import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features

from logger import get_logger

log = get_logger("scraper.auction")


class AuctionScraper(BaseScraper):
    """Scraper for land auction sites (Hubzu, Auction.com)."""

    SOURCE_NAME = "auction"
    BASE_URL = "https://www.hubzu.com"
    RATE_LIMIT_SECONDS = 2.5

    def fetch(self, state: str, max_pages: int = 3) -> list[dict[str, Any]]:
        """Fetch auction listings for a state."""
        results = []
        url = f"{self.BASE_URL}/search"
        params = {
            "state": state,
            "propertyType": "LAND,LOT",
            "page": 1,
        }

        try:
            response = self.get(url, params=params)
            soup = self.parse_html(response.text)

            cards = soup.select(
                ".property-listing, .listing-card, [class*='PropertyCard']"
            )
            for card in cards:
                data = self._parse_card(card, state)
                if data:
                    results.append(data)

        except Exception as e:
            log.info(f"[auction] Error for {state}: {e}")

        return results

    def _parse_card(self, card: Any, state: str) -> dict[str, Any] | None:
        """Parse a single auction listing card."""
        try:
            title_el = card.select_one("h2, h3, .property-title, .address")
            price_el = card.select_one(
                ".current-bid, .starting-bid, .price, [class*='price']"
            )
            link_el = card.select_one("a[href]")

            if not link_el:
                return None

            title = title_el.get_text(strip=True) if title_el else state
            price_text = re.sub(r"[^\d.]", "", price_el.get_text()) if price_el else "0"
            href = link_el.get("href", "")
            listing_id = re.search(r"/(\d+)/?", href)
            description = card.get_text(separator=" ", strip=True)[:500]

            # Try to extract acreage from description
            acres_match = re.search(r"([\d,.]+)\s*acres?", description, re.IGNORECASE)
            acres = float(re.sub(r",", "", acres_match.group(1))) if acres_match else 0

            return {
                "id": listing_id.group(1) if listing_id else href,
                "title": title,
                "price": float(price_text) if price_text else 0,
                "acres": acres,
                "state": state,
                "county": "",
                "url": f"{self.BASE_URL}{href}" if href.startswith("/") else href,
                "description": description,
            }
        except (AttributeError, ValueError):
            return None

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse an auction listing."""
        try:
            price = float(raw.get("price", 0))
            acres = float(raw.get("acres", 0))
            if price <= 0 or acres < 1:
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
                days_on_market=raw.get("daysOnMarket"),
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
