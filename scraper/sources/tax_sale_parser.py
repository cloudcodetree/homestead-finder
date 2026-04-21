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


def _ocr_placeholder(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Stub parser for counties whose PDFs are scanned images requiring OCR.

    Returns an empty list so the scraper gracefully skips the county until
    OCR support lands (tesseract + pdf2image, or Claude vision via `llm.py`
    for higher-quality extraction).
    """
    log.info("[tax_sale] OCR parser not yet implemented; skipping this county")
    return []


# Registry of parser name → implementation. Populate by adding new
# `_foo(pdf_bytes)` functions above and registering here.
PARSERS: dict[str, Callable[[bytes], list[dict[str, Any]]]] = {
    "wy_semicolon_pdf": _wy_semicolon_pdf,
    "ocr_placeholder": _ocr_placeholder,
}


def get_parser(name: str) -> Callable[[bytes], list[dict[str, Any]]] | None:
    """Return the parser function registered under `name`, or None if
    unregistered (caller should skip the source and log)."""
    return PARSERS.get(name)
