"""County tax lien/deed sale scraper — uses Selenium for JS-heavy county sites."""
from __future__ import annotations

import re
from typing import Any

from .base import BaseScraper, RawListing
from .landwatch import extract_features

# Counties known to post tax sale listings online
# Extend this list as new counties are verified
COUNTY_TAX_SALE_URLS: dict[str, list[dict[str, str]]] = {
    "MT": [
        {"county": "Broadwater", "url": "https://broadwatercounty.mt.gov/treasurer/tax-sale"},
        {"county": "Meagher", "url": "https://www.meaghercounty.org/treasurer"},
    ],
    "ID": [
        {"county": "Custer", "url": "https://www.co.custer.id.us/treasurer"},
    ],
    "TX": [
        {"county": "Wheeler", "url": "https://www.wheelercountytx.com/tax-sales"},
    ],
    "OK": [
        {"county": "Creek", "url": "https://www.creekcountyonline.com/treasurer"},
    ],
}


class CountyTaxScraper(BaseScraper):
    """Scraper for county tax deed/lien sale listings."""

    SOURCE_NAME = "county_tax"
    RATE_LIMIT_SECONDS = 3.0

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch tax sale listings for known counties in a state."""
        results = []
        counties = COUNTY_TAX_SALE_URLS.get(state.upper(), [])

        for county_info in counties:
            county = county_info["county"]
            url = county_info["url"]
            try:
                response = self.get(url)
                soup = self.parse_html(response.text)

                # Look for tables or lists of properties
                tables = soup.find_all("table")
                for table in tables:
                    rows = table.find_all("tr")[1:]  # skip header
                    for row in rows:
                        cells = row.find_all(["td", "th"])
                        if len(cells) >= 3:
                            text = " ".join(c.get_text(strip=True) for c in cells)
                            # Look for price-like and acreage-like patterns
                            price_match = re.search(r"\$[\d,]+", text)
                            acres_match = re.search(r"([\d.]+)\s*acres?", text, re.IGNORECASE)
                            if price_match and acres_match:
                                results.append({
                                    "id": f"{county}_{len(results)}",
                                    "title": f"Tax Sale — {county} County {state}",
                                    "price": float(re.sub(r"[^\d.]", "", price_match.group())),
                                    "acres": float(acres_match.group(1)),
                                    "state": state,
                                    "county": county,
                                    "url": url,
                                    "description": text[:500],
                                    "source": "county_tax",
                                })

            except Exception as e:
                print(f"  [county_tax] Error for {county}, {state}: {e}")

        return results

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a county tax sale listing."""
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
