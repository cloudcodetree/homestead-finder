"""Lands of America scraper — https://www.landsofamerica.com"""

from __future__ import annotations

import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features

from logger import get_logger

log = get_logger("scraper.lands_of_america")


class LandsOfAmericaScraper(BaseScraper):
    """Scraper for LandsOfAmerica.com property listings."""

    SOURCE_NAME = "lands_of_america"
    BASE_URL = "https://www.landsofamerica.com"
    RATE_LIMIT_SECONDS = 2.0

    def get_page_urls(self, state: str, max_pages: int = 5) -> list[str]:
        """Return search URLs for AI fallback."""
        return [
            f"{self.BASE_URL}/property/search/?st={state}&t=0&page={p}"
            for p in range(1, max_pages + 1)
        ]

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch land listings for a state.

        Goes through the strategy chain (curl_cffi → selenium → firecrawl)
        so the CF wall on LOA's WAF doesn't kill the scrape the way it
        does with plain `self.get()` — LOA shares LandWatch's parent
        company and uses the same anti-bot config.
        """
        results = []
        for page in range(1, max_pages + 1):
            url = (
                f"{self.BASE_URL}/property/search/"
                f"?st={state}&t=0&page={page}"
            )
            try:
                fetch_result = self.fetch_page(url)
            except Exception as e:
                log.info(f"[lands_of_america] fetch failed for {url}: {e}")
                break

            soup = self.parse_html(fetch_result.content)
            cards = soup.select(
                ".propCard, .property-card, [class*='PropertyCard']"
            )
            page_results: list[dict[str, Any]] = []
            for card in cards:
                data = self._parse_card(card, state)
                if data:
                    page_results.append(data)

            # Fallback: when the card selectors miss (LOA tweaks their
            # DOM periodically), reuse LandWatch's regex pseudo-markdown
            # trick on all `<a href="/property/...">` anchors so we
            # still get something rather than zero listings.
            if not page_results:
                page_results = self._regex_fallback(soup, state)

            log.info(
                f"[lands_of_america] {state} page {page}: "
                f"{len(page_results)} listings "
                f"(via {fetch_result.strategy_name}, {fetch_result.content_type})"
            )
            if not page_results:
                break
            results.extend(page_results)

        return results

    def _regex_fallback(self, soup: Any, state: str) -> list[dict[str, Any]]:
        """Regex-scrape `/property/<id>` anchors + nearby price/acreage."""
        # Piggy-back on the LandWatch markdown parser by emitting
        # pseudo-markdown. Different URL shape (`/property/N` vs
        # `/pid/N`) — we need a local parser.
        import re as _re

        prop_hits: dict[str, dict[str, Any]] = {}
        body_text = soup.get_text(" ", strip=True)
        anchor_list = list(soup.find_all("a", href=True))
        for anchor in anchor_list:
            href = anchor["href"]
            m = _re.search(r"/property/(\d+)", href)
            if not m:
                continue
            prop_id = m.group(1)
            if prop_id in prop_hits:
                continue
            text = anchor.get_text(" ", strip=True)
            prop_hits[prop_id] = {
                "id": prop_id,
                "title": text or f"Lands of America parcel {prop_id}",
                "url": href if href.startswith("http") else f"{self.BASE_URL}{href}",
            }

        results: list[dict[str, Any]] = []
        price_re = _re.compile(r"\$([\d,]+)")
        acres_re = _re.compile(r"([\d.]+)\s*(?:acres?|ac\b)", _re.IGNORECASE)
        for info in prop_hits.values():
            pos = body_text.find(info["title"])
            window = body_text[max(0, pos - 100) : pos + 400] if pos >= 0 else ""
            pm = price_re.search(window)
            am = acres_re.search(window)
            if not pm or not am:
                continue
            try:
                price = float(pm.group(1).replace(",", ""))
                acres = float(am.group(1))
            except ValueError:
                continue
            if price <= 0 or acres <= 0:
                continue
            results.append(
                {
                    **info,
                    "price": price,
                    "acres": acres,
                    "state": state,
                    "county": "",
                    "description": window[:500],
                }
            )
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
