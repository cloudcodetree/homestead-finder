"""GovEase scraper — tax lien/deed auctions from govease.com

GovEase hosts online tax sale auctions for counties across multiple states.
Data is server-rendered HTML with jQuery DataTables. Public access, no login required.
Permissive robots.txt.

Platform URL: https://liveauctions.govease.com
Listing URL pattern: /STATE/countycode/ID/browsebiddown
Detail URL pattern: /state/countycode/ID/openbidownparcel/PARCEL_DB_ID/PARCEL_NUMBER
AJAX pagination: POST /OpenAuction/RefreshBidDownAuctions
"""

from __future__ import annotations

import re
from typing import Any

from logger import get_logger
from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.govease")

BASE_URL = "https://liveauctions.govease.com"

# Counties on GovEase in our target states.
# Format: (state, county_name, url_code, county_id)
# Discovered from the platform's jurisdiction dropdown.
GOVEASE_COUNTIES: list[tuple[str, str, str, int]] = [
    # Alabama (active auctions — demo/testing)
    ("AL", "Autauga", "alautauga", 1268),
    ("AL", "Baldwin", "albaldwin", 1269),
    ("AL", "Shelby", "alshelby", 1294),
    # Colorado
    ("CO", "Costilla", "cocostilla", 1498),
    ("CO", "Douglas", "codecounty", 1339),
    ("CO", "Garfield", "cogarfield", 1340),
    ("CO", "Jefferson", "cojefferson", 1501),
    ("CO", "Larimer", "colarimer", 1455),
    ("CO", "Park", "copark", 1456),
    ("CO", "Pitkin", "copitkin", 1500),
    ("CO", "Saguache", "cosaguache", 1497),
    ("CO", "Summit", "cosummit", 1457),
    ("CO", "Teller", "coteller", 1458),
    # Tennessee
    ("TN", "Carroll", "tncarroll", 1434),
    ("TN", "Carter", "tncarter", 1396),
    ("TN", "Greene", "tngreene", 1397),
    ("TN", "Hamblen", "tnhamblen", 1398),
    ("TN", "Hardeman", "tnhardeman", 1464),
    ("TN", "Hawkins", "tnhawkins", 1399),
    ("TN", "Lawrence", "tnlawrence", 1435),
    ("TN", "Madison", "tnmadison", 1436),
    ("TN", "Rutherford", "tnrutherford", 1465),
    ("TN", "Sullivan", "tnsullivan", 1400),
    ("TN", "Tipton", "tntipton", 1437),
    ("TN", "Washington", "tnwashington", 1401),
    ("TN", "Wayne", "tnwayne", 1466),
    # Texas
    ("TX", "Denton", "txdenton", 1467),
    ("TX", "Grayson", "txgrayson", 1468),
    ("TX", "McLennan", "txmclennan", 1469),
    ("TX", "Wichita", "txwichita", 1470),
    # Washington
    ("WA", "Columbia", "wacolumbia", 1499),
]


class GovEaseScraper(BaseScraper):
    """Scraper for GovEase tax sale auctions.

    Scrapes public auction listings from liveauctions.govease.com.
    No login required. Respects rate limiting.
    """

    SOURCE_NAME = "govease"
    BASE_URL = BASE_URL
    RATE_LIMIT_SECONDS = 2.0

    def get_page_urls(self, state: str, max_pages: int = 5) -> list[str]:
        """Return browse URLs for counties in this state."""
        return [
            f"{BASE_URL}/{state}/{code}/{cid}/browsebiddown"
            for st, county, code, cid in GOVEASE_COUNTIES
            if st == state.upper()
        ]

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch all active auction listings for counties in the given state."""
        results: list[dict[str, Any]] = []
        state_upper = state.upper()

        counties = [
            (county, code, cid)
            for st, county, code, cid in GOVEASE_COUNTIES
            if st == state_upper
        ]

        if not counties:
            return results

        for county_name, url_code, county_id in counties:
            try:
                url = f"{BASE_URL}/{state_upper}/{url_code}/{county_id}/browsebiddown"
                log.info(
                    f"[govease] Fetching {county_name} County, {state_upper}: {url}"
                )

                result = self.fetch_page(url)
                soup = self.parse_html(result.content)

                # Parse the DataTable
                table = soup.select_one("table#dt-auctions, table.dataTable, table")
                if not table:
                    log.info(
                        f"[govease] No auction table found for {county_name}, {state_upper}"
                    )
                    continue

                rows = table.select("tbody tr")
                if not rows:
                    log.info(f"[govease] No listings for {county_name}, {state_upper}")
                    continue

                for row in rows:
                    cells = row.select("td")
                    if len(cells) < 5:
                        continue

                    listing = self._parse_row(
                        cells, row, state_upper, county_name, url_code, county_id
                    )
                    if listing:
                        results.append(listing)

                log.info(
                    f"[govease] {county_name}, {state_upper}: {len(rows)} rows found"
                )

            except Exception as e:
                log.info(f"[govease] Error for {county_name}, {state_upper}: {e}")

        return results

    def _parse_row(
        self,
        cells: list,
        row: Any,
        state: str,
        county: str,
        url_code: str,
        county_id: int,
    ) -> dict[str, Any] | None:
        """Parse a single table row into a raw listing dict.

        Known column layout (11 cells):
        [0] Watch  [1] empty  [2] Unique#  [3] Parcel#  [4] Owner
        [5] Face Value  [6] Address  [7] Auction Name  [8] Sale Type
        [9] Bidding  [10] My Bid
        """
        try:
            if len(cells) < 7:
                return None

            parcel_num = cells[3].get_text(strip=True) if len(cells) > 3 else ""
            owner = cells[4].get_text(strip=True) if len(cells) > 4 else ""
            face_value_text = cells[5].get_text(strip=True) if len(cells) > 5 else ""
            address = cells[6].get_text(strip=True) if len(cells) > 6 else ""
            auction_name = cells[7].get_text(strip=True) if len(cells) > 7 else ""
            sale_type = cells[8].get_text(strip=True) if len(cells) > 8 else ""

            # Skip empty/header rows
            if not parcel_num or parcel_num.lower() in ("parcel #", "no auctions"):
                return None

            # Parse price from face value
            price = 0.0
            price_match = re.search(r"\$[\d,]+\.?\d*", face_value_text)
            if price_match:
                price = float(price_match.group().replace("$", "").replace(",", ""))

            # Find detail link
            detail_url = ""
            link = row.select_one("a[href*='openbidownparcel']")
            if link:
                href = link.get("href", "")
                detail_url = f"{BASE_URL}{href}" if href.startswith("/") else href

            title = (
                f"{address} — {county} County, {state}"
                if address
                else f"Tax Sale — {county} County, {state}"
            )

            return {
                "id": parcel_num,
                "title": title,
                "price": price,
                "acres": 0,  # GovEase doesn't show acreage in browse table
                "state": state,
                "county": county,
                "url": detail_url
                or f"{BASE_URL}/{state}/{url_code}/{county_id}/browsebiddown",
                "description": f"{auction_name}. Owner: {owner}. Parcel: {parcel_num}. Face value: {face_value_text}. Type: {sale_type}",
                "parcel_number": parcel_num,
                "owner": owner,
                "sale_type": sale_type.lower().replace(" ", "_")
                if sale_type
                else "tax_sale",
            }
        except Exception as e:
            log.debug(f"[govease] Row parse error: {e}")
            return None

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a raw listing dict into a RawListing."""
        try:
            price = float(raw.get("price", 0))
            # For tax sales, even $0 face value can be valid (minimum bid)
            # But we still need at least some identifying info
            title = raw.get("title", "")
            if not title:
                return None

            description = raw.get("description", "")

            return RawListing(
                external_id=str(raw.get("id", "")),
                title=title,
                price=price,
                acreage=float(raw.get("acres", 0)),
                state=raw.get("state", ""),
                county=raw.get("county", ""),
                features=extract_features(description),
                description=description,
                url=raw.get("url", ""),
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
