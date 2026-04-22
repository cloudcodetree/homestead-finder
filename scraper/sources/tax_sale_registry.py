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
# - lien: certificate auction, multi-year redemption, then optional deed
# - deed: title auction, no post-sale redemption (WA model)
# - redeemable_deed: title auction with a short post-sale redemption
#     window during which the prior owner can buy the property back at a
#     statutory premium. Reverts to clean deed after the window. AR, TN,
#     GA, TX (non-homestead) follow this pattern.
# - hybrid: multi-stage pipeline where early offerings act lien-like
#     (certificate + redemption) and later offerings transition to deed
#     outright. MO's 1st/2nd/3rd Collector offerings are the canonical
#     example.
StateType = Literal["lien", "deed", "redeemable_deed", "hybrid"]


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


# MO is a hybrid state — Collector of Revenue holds 1st/2nd/3rd offerings
# for delinquent parcels. 1st and 2nd behave lien-like (certificate of
# purchase, 1-yr redemption period, 10% annual return if redeemed).
# Unsold parcels roll to 3rd offering which conveys a Collector's Deed
# with a 90-day quiet-title window — fastest clean-title path in the
# registry. All three pilot counties hold their sale on the 4th Monday
# of August per state statute (Aug 24, 2026).
MISSOURI_COUNTIES: list[TaxSaleSource] = [
    TaxSaleSource(
        county="Texas",
        state="MO",
        # Direct PDF URL discovered 2026-04-22. Texas County mirrors the
        # annual delinquent list on an eadn-wc01-* edge CDN; filename
        # is stable-ish ("Land-Tax-Sale-Update-4-1.pdf") but rotates
        # per sale year. Verify + refresh in July before the Aug sale.
        listUrl="https://eadn-wc01-3627135.nxedge.io/wp-content/uploads/Land-Tax-Sale-Update-4-1.pdf",
        listFormat="pdf",
        parser="missouri_collector_pdf",
        saleMonth=8,
        stateType="hybrid",
        notes=(
            "Largest MO county by area, Ozark core. 4th Monday of August "
            "sale at Courthouse (Aug 24, 2026). PDF rotates per year; "
            "landing page at texascountymissouri.gov/.../land-tax-sale/."
        ),
    ),
    TaxSaleSource(
        county="Reynolds",
        state="MO",
        listUrl="http://reynoldscountycollector.com/Delinquent.aspx",
        listFormat="html",
        parser="missouri_collector_aspx",
        saleMonth=8,
        stateType="hybrid",
        notes=(
            "Aspx-rendered delinquent list — parser fetches via Firecrawl "
            "to get server-rendered HTML. Tiny population (~6k), heavy "
            "forest, frequent 3rd-offering deed parcels. Sale Aug 24 2026."
        ),
    ),
    TaxSaleSource(
        county="Douglas",
        state="MO",
        listUrl="https://douglascountycollector.com/taxsale.php",
        listFormat="html",
        parser="missouri_collector_php",
        saleMonth=8,
        stateType="hybrid",
        notes=(
            "PHP-rendered sale page. Douglas requires 3 years delinquent "
            "before listing, so volume is lower but 3rd-offering deed "
            "conversion is high. Spring-fed Ozark water, Amish "
            "owner-finance belt. Sale Aug 24 2026 at the Ava courthouse."
        ),
    ),
]


# AR uses a statewide Commissioner of State Lands (COSL) program: all
# tax-delinquent parcels statewide certify to the state, which then
# auctions them by county-group catalog. Redeemable-deed state — 30-day
# post-sale redemption, then deed ripens clean. Carroll County's 2026
# sale is Aug 12; parcels populate closer to the auction date. COSL
# also runs post-auction/negotiated sales at auction.cosl.org — the
# app's "unadvertised gems" mandate fits this perfectly.
ARKANSAS_SOURCES: list[TaxSaleSource] = [
    TaxSaleSource(
        county="Carroll",
        state="AR",
        # COSL publishes per-county/per-date catalog pages. URL format
        # verified live 2026-04-22: county=CARR, saledate URL-encoded.
        # Parcel list populates closer to auction (Aug 12 2026) — before
        # then the page shows "check back closer to sale date".
        listUrl="https://www.cosl.org/Home/CatalogView?county=CARR&saledate=8%2F12%2F2026%2012%3A00%3A00%20AM",
        listFormat="html",
        parser="arkansas_cosl_catalog_html",
        saleMonth=8,
        stateType="redeemable_deed",
        notes=(
            "Eureka Springs (Carroll County) — 2026 COSL sale Aug 12. "
            "DataScoutPro powers the per-parcel links. Redemption window "
            "30 days post-sale, then clean deed. Update saledate in "
            "listUrl when the 2027 date is posted."
        ),
    ),
    TaxSaleSource(
        county="Carroll",
        state="AR",
        # Online post-auction/negotiated sale platform. Inventory rolls
        # here when parcels don't move at the public auction.
        listUrl="https://auction.cosl.org/Auctions/ListingsView",
        listFormat="html",
        parser="arkansas_cosl_negotiated",
        saleMonth=None,  # Year-round inventory
        stateType="redeemable_deed",
        notes=(
            "COSL online post-auction sale — year-round min-bid "
            "inventory of parcels that failed the public auction. "
            "Needs Firecrawl (JS-heavy .NET app). Filter to Carroll."
        ),
    ),
]


# Keyed by state for quick lookup. Registration ≠ active scraping — what
# runs daily is determined by `config.TARGET_STATES` (currently MO,AR
# for the Ozark pilot). WY/WA stay registered so the framework's
# reference-implementation tests (Park County fixture, Bid4Assets
# announcement shape) still execute; they just don't produce data
# because the state codes aren't in TARGET_STATES.
REGISTRY: dict[str, list[TaxSaleSource]] = {
    "MO": MISSOURI_COUNTIES,
    "AR": ARKANSAS_SOURCES,
    "WY": WYOMING_COUNTIES,
    "WA": WASHINGTON_COUNTIES,
}


def sources_for_state(state: str) -> list[TaxSaleSource]:
    """Return all configured tax-sale sources for a given state (case-insensitive)."""
    return REGISTRY.get(state.upper(), [])


def all_sources() -> list[TaxSaleSource]:
    """All registered sources across all states."""
    return [s for entries in REGISTRY.values() for s in entries]
