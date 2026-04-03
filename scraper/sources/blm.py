"""BLM/USDA land listing scraper — uses public data downloads."""
from __future__ import annotations

import csv
import io
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features

# BLM land sale notices are published at:
# https://www.blm.gov/programs/lands-and-realty/land-disposal/land-sales
BLM_NOTICE_URL = "https://www.blm.gov/programs/lands-and-realty/land-disposal/land-sales"

# State office URLs for BLM land sales
BLM_STATE_OFFICES: dict[str, str] = {
    "MT": "https://www.blm.gov/office/montana-dakotas-state-office",
    "ID": "https://www.blm.gov/office/idaho-state-office",
    "WY": "https://www.blm.gov/office/wyoming-state-office",
    "CO": "https://www.blm.gov/office/colorado-state-office",
    "NM": "https://www.blm.gov/office/new-mexico-state-office",
    "AZ": "https://www.blm.gov/office/arizona-state-office",
    "UT": "https://www.blm.gov/office/utah-state-office",
    "NV": "https://www.blm.gov/office/nevada-state-office",
    "OR": "https://www.blm.gov/office/oregon-washington-state-office",
}


class BLMScraper(BaseScraper):
    """Scraper for BLM (Bureau of Land Management) land sales."""

    SOURCE_NAME = "blm"
    RATE_LIMIT_SECONDS = 2.0

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch BLM land sale notices for a state."""
        results = []
        office_url = BLM_STATE_OFFICES.get(state.upper())
        if not office_url:
            return results

        try:
            response = self.get(BLM_NOTICE_URL)
            soup = self.parse_html(response.text)

            # Look for links to CSV or PDF downloads, or sale notices
            sale_links = soup.select("a[href*='sale'], a[href*='land-disposal'], a[href*='.csv']")
            for link in sale_links:
                href = link.get("href", "")
                if state.upper() in href.upper() or state.lower() in href.lower():
                    if href.endswith(".csv"):
                        try:
                            csv_response = self.get(href)
                            reader = csv.DictReader(io.StringIO(csv_response.text))
                            for row in reader:
                                results.append({**row, "state": state})
                        except Exception:
                            pass

            # Also scrape the state office page directly
            state_response = self.get(office_url)
            state_soup = self.parse_html(state_response.text)

            for article in state_soup.select("article, .views-row, .field-item"):
                text = article.get_text(separator=" ", strip=True)
                if any(kw in text.lower() for kw in ["acre", "land sale", "public land"]):
                    import re
                    price_match = re.search(r"\$[\d,]+", text)
                    acres_match = re.search(r"([\d,]+\.?\d*)\s*acres?", text, re.IGNORECASE)
                    link_el = article.select_one("a[href]")

                    if acres_match:
                        results.append({
                            "id": f"blm_{state}_{len(results)}",
                            "title": article.select_one("h2, h3, .title")
                                     and article.select_one("h2, h3, .title").get_text(strip=True)
                                     or f"BLM Land Sale — {state}",
                            "price": float(re.sub(r"[^\d.]", "", price_match.group())) if price_match else 0,
                            "acres": float(re.sub(r",", "", acres_match.group(1))),
                            "state": state,
                            "county": "",
                            "url": link_el.get("href", office_url) if link_el else office_url,
                            "description": text[:500],
                        })

        except Exception as e:
            print(f"  [blm] Error for {state}: {e}")

        return results

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a BLM land sale listing."""
        try:
            price = float(raw.get("price", 0))
            acres_raw = raw.get("acres", raw.get("Acres", raw.get("ACRES", 0)))
            acres = float(str(acres_raw).replace(",", "")) if acres_raw else 0

            if price <= 0 or acres < 5:
                return None

            description = raw.get("description", raw.get("Description", ""))
            title = raw.get("title", raw.get("Title", f"BLM Land — {raw.get('state', '')}"))

            return RawListing(
                external_id=str(raw.get("id", raw.get("CaseNumber", ""))),
                title=title,
                price=price,
                acreage=acres,
                state=raw.get("state", raw.get("State", "")),
                county=raw.get("county", raw.get("County", "")),
                features=extract_features(f"{title} {description} mineral rights hunting"),
                description=description,
                url=raw.get("url", BLM_NOTICE_URL),
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
