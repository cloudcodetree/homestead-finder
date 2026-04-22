"""Parsers for county tax-sale documents.

Each parser takes raw bytes (PDF) or text (HTML markdown) from a county
tax-sale list and returns a list of structured records:

    {
      "owner": str,
      "parcelId": str,
      "legalDescription": str,
      "houseNumber": str,
      "street": str,
      "propertyType": str,        # county-specific, often RE/IR
      "taxYear": int,
      "amountOwedUsd": float,
      "county": str,              # filled in by caller from the registry
      "state": str,
    }

Parsers are registered in `PARSERS` so the generic scraper can dispatch
by name from the registry entry. Add new parsers here, not inline.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from logger import get_logger

log = get_logger("scraper.tax_sale_parser")


def _wy_semicolon_pdf(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Parse the semicolon-delimited PDF format used by Park County WY
    (and likely other smaller WY counties using the same template).

    Record shape in the source PDF:
        OWNER;PARCEL;TAX_DIST;LEGAL_DESC;HOUSE#;STREET;TYPE;YEAR; ----- $AMOUNT

    Records are extracted by splitting the full document text on the
    terminal $X.XX amounts, then a regex pulls the structured fields out
    of each body.
    """
    try:
        import pdfplumber  # lazy import — heavy dep, not every scraper needs it
    except ImportError:
        log.info("[tax_sale] pdfplumber not installed; install via requirements.txt")
        return []

    import io

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        # pdfplumber can raise PdfminerException, ValueError, etc. on bad
        # input. Fail soft so an upstream fetch glitch doesn't crash the
        # whole scraper run.
        log.info(f"[tax_sale] PDF open failed: {type(e).__name__}: {e}")
        return []

    # Collapse whitespace + dash filler
    flat = re.sub(r"\s+", " ", text)
    flat = re.sub(r"-{2,}", " ", flat)

    # Split at $X.XX — each record ends at one. The first chunk is the
    # document preamble (notice text) and has no parseable parcel data.
    splits = re.split(r"(\$[\d,]+\.\d{2})", flat)
    records: list[str] = []
    prefix = splits[0]
    for i in range(1, len(splits), 2):
        amount = splits[i]
        records.append((prefix + amount).strip())
        prefix = splits[i + 1] if i + 1 < len(splits) else ""

    # Regex for the parcel fields — owner may include preamble for the
    # first record, which we strip below.
    record_re = re.compile(
        r"(?P<owner>[^;]+);"
        r"(?P<parcel>R?\d+);"
        r"(?P<dist>\d+);"
        r"(?P<legal>[^;]+);"
        r"(?P<house>\d*);"
        r"(?P<street>[^;]*);"
        r"(?P<type>\w+);"
        r"(?P<year>\d{4});.*?\$(?P<amount>[\d,]+\.\d{2})"
    )

    # Preamble phrases that should never appear in a legitimate owner name.
    # If present, the record's body still carries document-preamble text;
    # we trim to the last phrase-terminator.
    _PREAMBLE_MARKERS = (
        "AFORESAID",
        "HEREBY GIVEN",
        "NOTICE IS",
        "TO WIT:",
    )
    _TRIM_AFTER = (
        "DESCRIPTION OF PROPERTY PROPERTY WILL BE SOLD",
        "DESCRIPTION OF PROPERTY",
        "WILL BE SOLD",
        "TO WIT:",
    )

    results: list[dict[str, Any]] = []
    for body in records:
        m = record_re.search(body)
        if not m:
            continue
        owner = m.group("owner").strip()
        # First record of the PDF carries the legal preamble in its body;
        # trim at the last terminator we recognize.
        upper = owner.upper()
        for sep in _TRIM_AFTER:
            if sep in upper:
                idx = upper.rfind(sep) + len(sep)
                owner = owner[idx:].strip()
                upper = owner.upper()
                break
        # If preamble words still present, the regex captured something
        # invalid as the owner — drop the record rather than persist junk.
        if any(marker in owner.upper() for marker in _PREAMBLE_MARKERS):
            continue
        try:
            amount = float(m.group("amount").replace(",", ""))
            year = int(m.group("year"))
        except ValueError:
            continue
        results.append(
            {
                "owner": owner,
                "parcelId": m.group("parcel"),
                "taxDistrict": m.group("dist"),
                "legalDescription": m.group("legal").strip(),
                "houseNumber": m.group("house"),
                "street": m.group("street").strip(),
                "propertyType": m.group("type"),
                "taxYear": year,
                "amountOwedUsd": amount,
            }
        )
    return results


def _missouri_collector_pdf(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Parse a Missouri County Collector's annual delinquent-tax list.

    MO Collectors publish in mid-July for the August sale. Format varies
    county-by-county, but the common shape across Texas/Reynolds/Douglas
    pilot counties is a table with columns:

        PARCEL_ID | OWNER | LEGAL_DESCRIPTION | OFFERING | YEARS | AMOUNT

    where OFFERING is "1st" / "2nd" / "3rd" — the app's hybrid-state
    analytics keys off this to distinguish lien-style (1st/2nd, 1-yr
    redemption) vs deed-style (3rd, 90-day quiet-title) records.

    This is a SCAFFOLD — the three pilot Collector PDFs post mid-July
    and the exact column layout will be locked then. Until real PDFs
    are available we return [] so the pipeline logs + continues.
    """
    if not pdf_bytes:
        return []
    try:
        import pdfplumber
    except ImportError:
        log.info("[tax_sale:MO] pdfplumber not installed")
        return []
    log.info(
        "[tax_sale:MO] missouri_collector_pdf parser is a scaffold — "
        "column layout will be finalized against real 2026 Collector PDFs "
        "(posted mid-July for August sale). Returning 0 records."
    )
    return []


def _missouri_collector_aspx(markdown_bytes: bytes) -> list[dict[str, Any]]:
    """Parse Reynolds County MO Collector's .aspx delinquent list.

    Received as Firecrawl-rendered markdown. Reynolds publishes a table
    mid-July each year with columns similar to:

        PARCEL | OWNER | LEGAL | YEARS_DELINQUENT | AMOUNT_OWED

    SCAFFOLD — layout verified on the landing page, but no parcel data
    is posted between sale cycles (Aug-only). Will lock against real
    markdown once the 2026 list appears.
    """
    if not markdown_bytes:
        return []
    log.info(
        "[tax_sale:MO-Reynolds] missouri_collector_aspx parser is a scaffold; "
        "no parcel data expected outside the Jul-Aug sale window."
    )
    return []


def _missouri_collector_php(markdown_bytes: bytes) -> list[dict[str, Any]]:
    """Parse Douglas County MO Collector's .php sale page.

    Douglas requires 3 years of delinquency before offering a parcel,
    so the list is shorter but richer in 3rd-offering deed candidates.
    Table columns typically:

        PARCEL | OWNER | LEGAL_DESC | OFFERING_NUMBER | MIN_BID

    SCAFFOLD — lock against real markdown when 2026 list posts.
    """
    if not markdown_bytes:
        return []
    log.info(
        "[tax_sale:MO-Douglas] missouri_collector_php parser is a scaffold; "
        "no parcel data expected outside the Jul-Aug sale window."
    )
    return []


def _arkansas_cosl_catalog_html(markdown_bytes: bytes) -> list[dict[str, Any]]:
    """Parse the COSL per-county/per-date catalog page.

    URL shape: /Home/CatalogView?county=CARR&saledate=<MM/DD/YYYY>...

    The page shows "check back closer to sale date" when the catalog
    hasn't been published yet. When published, it's an HTML table linked
    to DataScoutPro parcel records.

    SCAFFOLD — Carroll County catalog publishes in the weeks before the
    Aug 12 2026 sale.
    """
    if not markdown_bytes:
        return []
    md = markdown_bytes.decode("utf-8", errors="ignore")
    if "check back closer" in md.lower() or "parcel catalog information" in md.lower():
        log.info(
            "[tax_sale:AR-Carroll] COSL catalog not yet published for this "
            "sale date — returning 0 records (expected pre-August)."
        )
        return []
    log.info(
        "[tax_sale:AR-Carroll] arkansas_cosl_catalog_html parser is a "
        "scaffold — lock against real catalog markup when published."
    )
    return []


def _arkansas_cosl_negotiated(html_bytes: bytes) -> list[dict[str, Any]]:
    """Parse the Arkansas COSL post-auction / negotiated-sales listing.

    The page at `auction.cosl.org/Auctions/ListingsView` is a Blazor-
    rendered Kendo grid. Each `<tr class="k-master-row">` is one
    parcel with these columns (verified 2026-04-22):

        0: Owner                    e.g. "LARRY C NANCE JR"
        1: County                   e.g. "JEFFERSON" / "CARROLL"
        2: Parcel #                 e.g. "931-92009-000"
        3: Acres                    integer or decimal string
        4: Section                  e.g. "03"
        5: Township                 e.g. "07S"
        6: Range                    e.g. "09W"
        7: Starting Bid             "$11,785.95"
        8: Current Bid              "$0.00" when no bids yet
        9: Added On                 "1/15/2026 06:05 AM"
        10: Bid button (<a href="/Auction/Listing/<token>">)

    This is the "unadvertised gems" layer — every parcel here failed
    the public auction and is now offered at minimum-bid, year-round.
    No redemption window applies to post-auction sales in Arkansas.

    Requires Playwright-rendered HTML; curl_cffi only returns the
    Blazor shell. The scraper's strategy chain handles this — we just
    need to keep the html-vs-markdown content type honest.
    """
    if not html_bytes:
        return []
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        log.info("[tax_sale:AR] bs4 not installed")
        return []
    try:
        soup = BeautifulSoup(html_bytes, "lxml")
    except Exception as e:
        log.info(f"[tax_sale:AR] BS4 parse failed: {type(e).__name__}: {e}")
        return []

    rows = soup.select("tr.k-master-row")
    if not rows:
        log.info(
            "[tax_sale:AR] no k-master-row elements found — page likely "
            "fetched without JS rendering (need Playwright)."
        )
        return []

    results: list[dict[str, Any]] = []
    for tr in rows:
        cells = tr.select("td")
        # Expected 11 cells — 10 data + 1 action button
        if len(cells) < 10:
            continue
        owner = cells[0].get_text(" ", strip=True)
        county = cells[1].get_text(" ", strip=True).title()
        parcel = cells[2].get_text(" ", strip=True)
        acres_raw = cells[3].get_text(" ", strip=True)
        section = cells[4].get_text(" ", strip=True)
        township = cells[5].get_text(" ", strip=True)
        range_ = cells[6].get_text(" ", strip=True)
        starting_raw = cells[7].get_text(" ", strip=True)
        current_raw = cells[8].get_text(" ", strip=True)
        added_on = cells[9].get_text(" ", strip=True)

        # Parse numerics
        try:
            acres = float(re.sub(r"[^\d.]", "", acres_raw) or 0)
        except ValueError:
            acres = 0.0
        try:
            starting = float(re.sub(r"[^\d.]", "", starting_raw) or 0)
        except ValueError:
            starting = 0.0
        try:
            current = float(re.sub(r"[^\d.]", "", current_raw) or 0)
        except ValueError:
            current = 0.0
        # "Amount owed" on COSL sales is effectively the minimum starting
        # bid — that's what a buyer actually needs to beat. Use it as the
        # `amountOwedUsd` stand-in for downstream scoring.
        amount_owed = starting or current or 0.0
        if not parcel or amount_owed <= 0:
            continue

        # Per-parcel detail link (action button)
        detail_url = ""
        bid_anchor = tr.select_one('a[href*="/Auction/Listing/"]')
        if bid_anchor and bid_anchor.get("href"):
            href = bid_anchor["href"]
            detail_url = (
                f"https://auction.cosl.org{href}" if href.startswith("/") else href
            )

        legal_bits = [
            f"Section {section}" if section else "",
            f"Township {township}" if township else "",
            f"Range {range_}" if range_ else "",
        ]
        legal = " ".join(bit for bit in legal_bits if bit)

        results.append(
            {
                "owner": owner,
                "parcelId": parcel,
                "taxDistrict": "",
                "legalDescription": legal,
                "houseNumber": "",
                "street": "",
                "propertyType": "POST_AUCTION",
                "taxYear": None,
                "amountOwedUsd": amount_owed,
                "acres": acres,  # carried through on `raw`; to_property doesn't
                # consume acres directly but the parcel detail renderer can.
                "detailUrl": detail_url,
                "currentBidUsd": current,
                "addedOn": added_on,
                "countyLabel": county,
            }
        )
    log.info(f"[tax_sale:AR] COSL negotiated: {len(results)} parcels parsed")
    return results


def _ocr_placeholder(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Stub parser for counties whose PDFs are scanned images requiring OCR.

    Returns an empty list so the scraper gracefully skips the county until
    OCR support lands (tesseract + pdf2image, or Claude vision via `llm.py`
    for higher-quality extraction).
    """
    log.info("[tax_sale] OCR parser not yet implemented; skipping this county")
    return []


# Bid4Assets auction-storefront parser. Per-parcel data on B4A is auth-
# gated, so we scrape the *public* storefront markdown (Firecrawl) for
# sale-announcement data only: sale date window, deposit amount, lot
# count, buyer's premium, and the canonical storefront URL. The result
# is ONE "sale event" row per county/sale, not per parcel. Useful so
# users can track upcoming deed sales and click through to register /
# bid directly on Bid4Assets.
_B4A_STARTS_RE = re.compile(r"Starts([A-Za-z]+\s+\d+,\s*\d{4}[^-\n]*)")
_B4A_ENDS_RE = re.compile(r"Ends([A-Za-z]+\s+\d+,\s*\d{4})")
_B4A_LOT_COUNT_RE = re.compile(
    r"offering\s+(\d{1,4})\s+tax[\s-]?foreclosed", re.IGNORECASE
)
_B4A_DEPOSIT_RE = re.compile(
    r"\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{2})?\s+(?:refundable\s+)?deposit",
    re.IGNORECASE,
)
_B4A_PREMIUM_RE = re.compile(r"(\d{1,2})%\s+buyer[’'`]?s?\s+premium", re.IGNORECASE)


def _bid4assets_announcement(markdown_bytes: bytes) -> list[dict[str, Any]]:
    """Parse a Bid4Assets storefront page (received as UTF-8 bytes) into
    a single sale-announcement record. Returns an empty list if the page
    doesn't look like a storefront (schedule info absent).
    """
    try:
        md = markdown_bytes.decode("utf-8", errors="ignore")
    except Exception:
        return []
    if not md or "Bid4Assets" not in md and "storefront" not in md.lower():
        # Weak signal — maybe the caller handed us the wrong bytes.
        if "Starts" not in md or "Ends" not in md:
            return []

    starts = _B4A_STARTS_RE.search(md)
    ends = _B4A_ENDS_RE.search(md)
    if not (starts or ends):
        return []

    lot_count_match = _B4A_LOT_COUNT_RE.search(md)
    deposit_match = _B4A_DEPOSIT_RE.search(md)
    premium_match = _B4A_PREMIUM_RE.search(md)

    lot_count = int(lot_count_match.group(1)) if lot_count_match else None
    deposit_usd = None
    if deposit_match:
        try:
            deposit_usd = float(deposit_match.group(1).replace(",", ""))
        except ValueError:
            deposit_usd = None
    premium_pct = int(premium_match.group(1)) if premium_match else None

    # Free-form headline from the page H1 + H2 when available
    h1 = re.search(r"^#\s+(.+)$", md, re.MULTILINE)
    h2 = re.search(r"^##\s+(.+)$", md, re.MULTILINE)
    county_label = h1.group(1).strip() if h1 else ""
    sale_label = h2.group(1).strip() if h2 else ""

    # The "minimum bid" on an announcement row is a conceptual stand-in:
    # we use the deposit amount so the listing has a positive `price`
    # value and renders alongside per-parcel rows. Downstream analytics
    # skip this (no parcelId → no investment multiple).
    min_bid_stand_in = deposit_usd or 1.0

    return [
        {
            "owner": "",
            "parcelId": f"sale_{starts.group(1).strip().replace(' ', '_').replace(',', '') if starts else 'upcoming'}",
            "taxDistrict": "",
            "legalDescription": (
                f"Sale event: {sale_label or 'Tax-foreclosed properties auction'}."
                f" {lot_count or '?'} lots offered."
                f" Starts {starts.group(1).strip() if starts else '?'},"
                f" ends {ends.group(1).strip() if ends else '?'}."
            ),
            "houseNumber": "",
            "street": "",
            "propertyType": "SALE_EVENT",
            "taxYear": None,
            "amountOwedUsd": min_bid_stand_in,
            "countyLabel": county_label,
            "lotCount": lot_count,
            "depositUsd": deposit_usd,
            "premiumPct": premium_pct,
            "isSaleAnnouncement": True,
        }
    ]


# Registry of parser name → implementation. Populate by adding new
# `_foo(bytes)` functions above and registering here. All parsers accept
# `bytes` (PDF or UTF-8 markdown) so the dispatcher can treat them
# uniformly.
PARSERS: dict[str, Callable[[bytes], list[dict[str, Any]]]] = {
    "wy_semicolon_pdf": _wy_semicolon_pdf,
    "missouri_collector_pdf": _missouri_collector_pdf,
    "missouri_collector_aspx": _missouri_collector_aspx,
    "missouri_collector_php": _missouri_collector_php,
    "arkansas_cosl_catalog_html": _arkansas_cosl_catalog_html,
    "arkansas_cosl_negotiated": _arkansas_cosl_negotiated,
    "ocr_placeholder": _ocr_placeholder,
    "bid4assets_announcement": _bid4assets_announcement,
}


def get_parser(name: str) -> Callable[[bytes], list[dict[str, Any]]] | None:
    """Return the parser function registered under `name`, or None if
    unregistered (caller should skip the source and log)."""
    return PARSERS.get(name)
