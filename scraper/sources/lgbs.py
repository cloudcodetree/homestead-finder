"""Linebarger Goggan Blair & Sampson tax-sale scraper.

LGBS is the largest delinquent-tax law firm in Texas. They publish
upcoming county tax sales through an undocumented but stable JSON
API at `taxsales.lgbs.com/api/property_sales/`. Pulling from the API
is the cleanest tax-sale ingestion we have:

  - Server-rendered JSON (no Cloudflare, no Selenium)
  - Per-row: parcel ID, address, city, ZIP, lat/lng, appraised value,
    minimum bid, sale date, status (Active/Cancelled/Postponed)
  - Roughly 30 TX counties enrolled (a subset of all 254 — the rest
    use other firms or sell direct via constables / GovEase / Bid4Assets)

Of our 14 Austin-area target counties, LGBS covers **Caldwell** and
**Llano**. Travis/Williamson/Hays/Bastrop/etc. use different vendors
and are handled by other scrapers (auction / govease / per-county
clerk feeds added later).

Every row becomes a Property with `status='tax_sale'` and a populated
`taxSale` sub-object — same shape as `county_tax` rows so the
frontend renders them through the existing tax-sale UI without
additional work.

Public-records source. TX Public Information Act makes county tax
delinquency rolls explicitly public; LGBS aggregates and republishes
them on behalf of their county clients. Throttled at 2s between
requests to stay polite.
"""

from __future__ import annotations

from typing import Any

import requests

from logger import get_logger

from .base import BaseScraper, RawListing

log = get_logger("scraper.lgbs")

LGBS_API = "https://taxsales.lgbs.com/api/property_sales/"

# Subset of LGBS-covered counties that intersect with our TARGET_COUNTIES.
# Counties LGBS knows about but we don't target are skipped — pulling
# all 30 enrolled counties would balloon the corpus with non-target
# rows we'd just filter out client-side anyway.
LGBS_TARGET_COUNTIES_BY_STATE: dict[str, list[str]] = {
    "TX": [
        # Order doesn't matter — kept matching TARGET_COUNTIES grouping
        # for grep-ability with config.py.
        "CALDWELL COUNTY",
        "LLANO COUNTY",
    ],
}


class LGBSScraper(BaseScraper):
    """Scraper for Linebarger's tax-sale aggregator."""

    SOURCE_NAME = "lgbs"
    BASE_URL = LGBS_API
    RATE_LIMIT_SECONDS = 2.0

    # ── fetch ───────────────────────────────────────────────────────────────

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch all upcoming tax-sale parcels for our target counties
        in `state`. `max_pages` is honored as the per-county pagination
        ceiling — at 200 rows/page that's 1k rows max per county, well
        above any real county's roll size."""
        counties = LGBS_TARGET_COUNTIES_BY_STATE.get(state.upper(), [])
        if not counties:
            log.info(f"[lgbs] no LGBS-covered target counties for {state}")
            return []
        results: list[dict[str, Any]] = []
        for county in counties:
            try:
                results.extend(self._fetch_county(state, county, max_pages))
            except Exception as e:
                log.info(
                    f"[lgbs] fetch failed for {county}/{state}: "
                    f"{type(e).__name__}: {e}"
                )
        log.info(f"[lgbs] {state}: {len(results)} tax-sale parcels across {len(counties)} counties")
        return results

    def _fetch_county(
        self, state: str, county: str, max_pages: int
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        url: str | None = (
            f"{LGBS_API}?county={requests.utils.quote(county)}&state={state.upper()}&limit=200"
        )
        pages = 0
        while url and pages < max_pages:
            self.sleep()
            r = self.session.get(url, timeout=20)
            if r.status_code != 200:
                log.info(f"[lgbs] {county}: HTTP {r.status_code} on page {pages + 1}")
                break
            payload = r.json()
            rows.extend(payload.get("results", []) or [])
            # API hands us absolute URLs in `next`; normalize to https
            # because the LGBS server returns http:// links even though
            # the canonical site is https-only (the http URLs redirect,
            # but pre-rewriting keeps the request path tidy).
            nxt = payload.get("next")
            url = nxt.replace("http://", "https://") if nxt else None
            pages += 1
        return rows

    # ── parse ──────────────────────────────────────────────────────────────

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Convert one LGBS API row into a RawListing.

        Skips rows where the sale was cancelled, withdrawn, or sold —
        we only want active/upcoming auctions. Cancelled rows linger in
        the API for ~30 days post-sale-date; without this filter the
        corpus accumulates dead rows.
        """
        status = (raw.get("status") or "").strip().lower()
        if status in {"cancelled", "withdrawn", "sold", "redeemed"}:
            return None

        county_full = (raw.get("county") or "").strip()  # "CALDWELL COUNTY"
        # Strip the trailing " COUNTY" so the property's location.county
        # matches the rest of the corpus (LandWatch et al. use
        # "Caldwell" not "Caldwell County" / "CALDWELL COUNTY").
        county = county_full.replace(" COUNTY", "").strip().title() or "Unknown"
        state = (raw.get("state") or "").strip().upper()

        # Minimum bid is the floor for the auction; appraised value is
        # the (often ambitious) county estimate. Use minimum_bid as the
        # `price` so $/ac calculations later don't read off the
        # appraisal balloon.
        min_bid = float(raw.get("minimum_bid") or 0)
        if min_bid <= 0:
            return None

        addr1 = (raw.get("prop_address_one") or "").strip()
        addr2 = (raw.get("prop_address_two") or "").strip()
        city = (raw.get("prop_city") or "").strip()
        zipcode = (raw.get("prop_zipcode") or "").strip()
        full_addr = ", ".join(p for p in [addr1, addr2, city, zipcode] if p)

        parcel = (raw.get("account_nbr") or "").strip()
        sale_date = (raw.get("sale_date_only") or "").strip()
        cause = (raw.get("cause_nbr") or "").strip()

        title_parts = ["Tax sale —", county, "Co,", state]
        if addr1:
            title_parts.append("·")
            title_parts.append(addr1)
        title = " ".join(title_parts)

        description = (
            f"Delinquent tax-sale parcel in {county} County, {state}. "
            f"Cause #{cause}. Sale {sale_date}. Minimum bid ${min_bid:,.0f}. "
            f"County-appraised value ${float(raw.get('value') or 0):,.0f}. "
            f"Address: {full_addr or 'unknown'}. Account #{parcel}."
        )

        # `geometry` is GeoJSON Point — coordinates are [lng, lat] per
        # spec. LGBS occasionally ships zero coords for parcels their
        # geocoder couldn't resolve; treat those as missing.
        geom = raw.get("geometry") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        lat = lng = None
        if isinstance(coords, list) and len(coords) == 2:
            lng_raw, lat_raw = coords
            try:
                lat = float(lat_raw)
                lng = float(lng_raw)
                if lat == 0 and lng == 0:
                    lat = lng = None
            except (TypeError, ValueError):
                lat = lng = None

        # Stable per-parcel external ID. `uid` is LGBS's primary key;
        # falling back to cause+parcel keeps it deterministic if a row
        # ever ships without `uid`.
        external = (
            str(raw.get("uid"))
            if raw.get("uid") is not None
            else f"{state}_{county}_{cause}_{parcel}".lower().replace(" ", "_")
        )

        return RawListing(
            external_id=external,
            title=title[:160],
            price=min_bid,
            acreage=0.0,  # LGBS doesn't ship acreage; CAD lookup later if needed
            state=state,
            county=county,
            url=(raw.get("property_loc") or LGBS_API).strip(),
            lat=lat,
            lng=lng,
            features=[],
            description=description,
            raw={
                # Re-shape into the same dict the county_tax to_property
                # override expects — that way `taxSale` sub-object lands
                # populated without duplicating mapping logic here.
                "owner": "",
                "parcelId": parcel,
                "taxDistrict": "",
                "legalDescription": "",
                "houseNumber": "",
                "street": (raw.get("street_name") or "").strip(),
                "propertyType": "",
                "taxYear": None,
                "amountOwedUsd": min_bid,
                "saleMonth": int(sale_date.split("-")[1]) if "-" in sale_date else None,
                # TX is a deed state — buyer takes title at the auction
                # subject to a 180-day or 2-year right of redemption
                # depending on whether the property was a homestead.
                # The frontend's `redeemable_deed` style covers this.
                "stateType": "redeemable_deed",
                "state": state,
                "county": county,
                "listUrl": (raw.get("county_sale_list") or "").strip(),
                "saleDate": sale_date,
                "causeNumber": cause,
                "appraisedValueUsd": float(raw.get("value") or 0),
                "lgbsSaleId": raw.get("sale_id"),
                "address": full_addr,
            },
        )

    # ── normalize ──────────────────────────────────────────────────────────

    def to_property(self, raw: RawListing) -> dict[str, Any]:
        """Stamp `status='tax_sale'` and populate the `taxSale`
        sub-object the frontend renders."""
        prop = super().to_property(raw)
        src = raw.raw or {}
        prop["status"] = "tax_sale"
        prop["taxSale"] = {
            "owner": src.get("owner", ""),
            "parcelId": src.get("parcelId", ""),
            "legalDescription": src.get("legalDescription", ""),
            "houseNumber": src.get("houseNumber", ""),
            "street": src.get("street", ""),
            "propertyType": src.get("propertyType", ""),
            "taxYear": src.get("taxYear"),
            "amountOwedUsd": src.get("amountOwedUsd"),
            "saleMonth": src.get("saleMonth"),
            "stateType": src.get("stateType"),
            "state": src.get("state", ""),
            "county": src.get("county", ""),
            "listUrl": src.get("listUrl", ""),
        }
        return prop
