"""Declarative registry of county tax-sale sources.

Each entry describes how to fetch and parse one county's annual delinquent
tax-sale list. Adding a new county is (mostly) a configuration change —
the generic scraper reads this registry, picks the right fetch strategy
by `listFormat`, and the right parser by `parser`.

Schema:
    county        — county name (sans "County")
    state         — 2-letter state code
    listUrl       — direct URL to the list document (PDF or HTML page)
    listFormat    — 'pdf' | 'html' | 'bid4assets' | 'govease'
    parser        — name of a registered parser in tax_sale_parser.py
    saleMonth     — typical month the in-person sale is held (1-12 or None)
    stateType     — 'lien' (cert auction) | 'deed' (title auction)
    notes         — free-form context for maintainers
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ListFormat = Literal["pdf", "html", "bid4assets", "bid4assets_announcement", "govease"]
StateType = Literal["lien", "deed"]


@dataclass(frozen=True)
class TaxSaleSource:
    county: str
    state: str
    listUrl: str
    listFormat: ListFormat
    parser: str
    saleMonth: int | None
    stateType: StateType
    notes: str = ""


# WY is a lien state — counties auction tax-lien certificates, 3-yr
# redemption period, then certificate-holder can apply for the tax deed.
# All five entries below are verified April 2026.
WYOMING_COUNTIES: list[TaxSaleSource] = [
    TaxSaleSource(
        county="Park",
        state="WY",
        listUrl="https://parkcounty-wy.gov/wp-content/uploads/Documents/Treasurer/Documents/2025/2024%20Tax%20Sale%20List.pdf",
        listFormat="pdf",
        parser="wy_semicolon_pdf",
        saleMonth=8,
        stateType="lien",
        notes=(
            "Semicolon-delimited record format — "
            "OWNER;PARCEL;DIST;LEGAL;HOUSE#;STREET;TYPE;YEAR;$AMOUNT. "
            "URL path templated per year — update when new list posted."
        ),
    ),
    TaxSaleSource(
        county="Natrona",
        state="WY",
        listUrl="https://www.natronacounty-wy.gov/DocumentCenter/View/12592/Delinquent-List-2025",
        listFormat="pdf",
        parser="ocr_placeholder",
        saleMonth=9,
        stateType="lien",
        notes=(
            "Scanned PDF — needs OCR (tesseract). Registered with a "
            "placeholder parser until OCR support is added."
        ),
    ),
]


# WA is a deed state — tax-foreclosed properties are auctioned outright,
# no redemption period after the sale. Per-parcel data on Bid4Assets is
# auth-gated; we scrape storefront pages for sale-event announcements
# (date, deposit, lot count). Per-parcel coverage will follow via
# alternative sources (GovEase for Stevens, etc.) when upcoming sales go
# live — those storefronts return empty lists between cycles.
WASHINGTON_COUNTIES: list[TaxSaleSource] = [
    TaxSaleSource(
        county="King",
        state="WA",
        listUrl="https://www.bid4assets.com/king",
        listFormat="bid4assets_announcement",
        parser="bid4assets_announcement",
        saleMonth=9,
        stateType="deed",
        notes=(
            "Uses Bid4Assets storefront. Per-parcel auction data is "
            "auth-gated; we surface the sale event (date, lots, deposit) "
            "and link out."
        ),
    ),
    TaxSaleSource(
        county="Pierce",
        state="WA",
        listUrl="https://www.bid4assets.com/storefront/PierceATNov25",
        listFormat="bid4assets_announcement",
        parser="bid4assets_announcement",
        saleMonth=11,
        stateType="deed",
        notes="Storefront URL rotates per sale — update when next auction is posted.",
    ),
    TaxSaleSource(
        county="Snohomish",
        state="WA",
        listUrl="https://www.bid4assets.com/storefront/SnohomishCoDec25Reoffer",
        listFormat="bid4assets_announcement",
        parser="bid4assets_announcement",
        saleMonth=11,
        stateType="deed",
        notes=(
            "Moved to Bid4Assets in 2022. Regular Nov sale + Dec re-offers. "
            "URL rotates per sale event."
        ),
    ),
]


# Keyed by state for quick lookup.
REGISTRY: dict[str, list[TaxSaleSource]] = {
    "WY": WYOMING_COUNTIES,
    "WA": WASHINGTON_COUNTIES,
}


def sources_for_state(state: str) -> list[TaxSaleSource]:
    """Return all configured tax-sale sources for a given state (case-insensitive)."""
    return REGISTRY.get(state.upper(), [])


def all_sources() -> list[TaxSaleSource]:
    """All registered sources across all states."""
    return [s for entries in REGISTRY.values() for s in entries]
