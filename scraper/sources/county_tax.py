"""County tax-sale scraper.

Reads the declarative tax-sale registry in `tax_sale_registry.py`,
fetches each county's list via the appropriate strategy (direct PDF
download for now; HTML / Bid4Assets / GovEase adapters can be plugged in
later), and parses via the registered parser in `tax_sale_parser.py`.

Each output row is a single delinquent parcel, not a listing in the
traditional "for sale" sense — but they feed into the same Property
shape so the frontend can render them alongside LandWatch listings with
a `status = 'tax_sale'` badge.

See ADR-014 (forthcoming) for the architecture rationale.
"""

from __future__ import annotations

from typing import Any

import requests

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features
from .tax_sale_parser import get_parser
from .tax_sale_registry import TaxSaleSource, sources_for_state

log = get_logger("scraper.county_tax")


class CountyTaxScraper(BaseScraper):
    """Scraper for county tax-sale (delinquent-property) lists.

    Driven by `tax_sale_registry.py` — adding a new county is a config
    change plus (if its list format is new) a parser function. See
    `tax_sale_parser.PARSERS` for the parsers already registered.
    """

    SOURCE_NAME = "county_tax"
    RATE_LIMIT_SECONDS = 3.0

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Return raw parcel records for every configured county in `state`."""
        results: list[dict[str, Any]] = []
        for source in sources_for_state(state):
            try:
                results.extend(self._fetch_source(source))
            except Exception as e:  # pragma: no cover — defensive
                log.info(
                    f"[tax_sale] unhandled error on {source.county} {state}: "
                    f"{type(e).__name__}: {e}"
                )
        return results

    # ── per-source fetchers ─────────────────────────────────────────────────

    def _fetch_source(self, source: TaxSaleSource) -> list[dict[str, Any]]:
        parser = get_parser(source.parser)
        if parser is None:
            log.info(
                f"[tax_sale] no parser registered for "
                f"{source.county} {source.state}: {source.parser}"
            )
            return []

        if source.listFormat == "pdf":
            raw_bytes = self._download_pdf(source.listUrl)
            if not raw_bytes:
                return []
            records = parser(raw_bytes)
        elif source.listFormat == "html":
            log.info("[tax_sale] html parser dispatch not yet implemented")
            return []
        else:
            log.info(f"[tax_sale] list format {source.listFormat!r} not yet supported")
            return []

        log.info(
            f"[tax_sale] {source.county} {source.state}: "
            f"{len(records)} parcel records"
        )
        # Stamp every record with the county/state from the registry so the
        # parser can stay agnostic.
        for rec in records:
            rec["county"] = source.county
            rec["state"] = source.state
            rec["saleMonth"] = source.saleMonth
            rec["stateType"] = source.stateType
            rec["listUrl"] = source.listUrl
        return records

    def _download_pdf(self, url: str) -> bytes:
        """Download a PDF with a normal User-Agent. Returns empty bytes
        on any failure; the caller logs."""
        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            if "application/pdf" not in resp.headers.get("Content-Type", "").lower():
                log.info(
                    f"[tax_sale] non-PDF response for {url}: "
                    f"{resp.headers.get('Content-Type')}"
                )
                return b""
            return resp.content
        except requests.RequestException as e:
            log.info(f"[tax_sale] download failed for {url}: {e}")
            return b""

    # ── record → RawListing ────────────────────────────────────────────────

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Map a parsed tax-sale record into the shared RawListing shape.

        These rows don't have a listing price per se — they have an amount
        owed. We place that in `price` as a useful stand-in (it's the
        minimum bid to claim the lien certificate) and set `acreage=0`
        since the PDF lists don't carry parcel size. Geocoding + county
        parcel lookup will enrich downstream.
        """
        owner = str(raw.get("owner", "")).strip()
        parcel = str(raw.get("parcelId", "")).strip()
        amount = float(raw.get("amountOwedUsd", 0) or 0)
        if not parcel or amount <= 0:
            return None

        county = str(raw.get("county", "")).strip()
        state = str(raw.get("state", "")).strip()
        legal = str(raw.get("legalDescription", "")).strip()
        street = str(raw.get("street", "")).strip()
        house = str(raw.get("houseNumber", "")).strip()

        address_parts = [p for p in (house, street) if p]
        address = " ".join(address_parts) if address_parts else legal
        title = (
            f"Tax sale — {county} County, {state}: {address[:80]}"
            if address
            else (f"Tax sale — {county} County, {state}")
        )
        description_lines = [
            f"Delinquent tax sale, {county} County, {state}.",
            f"Owner: {owner}" if owner else "",
            f"Parcel ID: {parcel}",
            f"Legal description: {legal}" if legal else "",
            f"Owed: ${amount:,.2f} (tax year {raw.get('taxYear', 'unknown')})",
        ]
        description = "\n".join(line for line in description_lines if line)

        list_url = str(raw.get("listUrl", ""))
        # Every parcel on the same tax-sale PDF shares the listUrl, but
        # main.py deduplicates by URL — so we need a per-parcel anchor to
        # keep all records distinct. The fragment is ignored by the server
        # when followed, so the link still opens the same PDF.
        parcel_url = (
            f"{list_url}#parcel={parcel}"
            if list_url
            else f"parcel://{state}/{county}/{parcel}"
        )
        return RawListing(
            external_id=f"{state}_{county}_{parcel}".lower().replace(" ", "_"),
            title=title,
            price=amount,
            acreage=0.0,  # unknown until parcel lookup
            state=state,
            county=county,
            features=extract_features(f"{title} {description}"),
            description=description,
            url=parcel_url,
            raw=raw,
        )

    def to_property(self, raw: RawListing) -> dict[str, Any]:
        """Override: tag every tax-sale row with status='tax_sale' and a
        structured `taxSale` sub-object the frontend can surface directly.
        """
        prop = super().to_property(raw)
        src = raw.raw or {}
        prop["status"] = "tax_sale"
        prop["taxSale"] = {
            "owner": src.get("owner", ""),
            "parcelId": src.get("parcelId", ""),
            "taxDistrict": src.get("taxDistrict", ""),
            "legalDescription": src.get("legalDescription", ""),
            "houseNumber": src.get("houseNumber", ""),
            "street": src.get("street", ""),
            "propertyType": src.get("propertyType", ""),
            "taxYear": src.get("taxYear"),
            "amountOwedUsd": src.get("amountOwedUsd"),
            "saleMonth": src.get("saleMonth"),
            "stateType": src.get("stateType"),
            "listUrl": src.get("listUrl", ""),
        }
        return prop
