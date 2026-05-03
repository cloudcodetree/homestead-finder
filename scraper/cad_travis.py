"""Travis CAD bulk-export parser.

Travis Central Appraisal District publishes the full county appraisal
roll annually as a PACS (Tyler/True Automation) fixed-width export.
The download is a 465 MB ZIP containing 21 text files; we only need
PROP.TXT (the main parcel record, one row per parcel/owner pair).

Public source under TX Public Information Act. Run locally:

    python -m scraper.cad_travis  \\
        --zip data/cad/travis_cad_2025_certified.zip \\
        --out data/cad_travis_parcels.json

Streams the ZIP without extracting it (PROP.TXT is 4.5 GB
uncompressed; we never touch disk for it). Outputs a compact JSON
keyed by `geo_id` (the public-facing parcel-ID printed on county
records) → per-parcel summary used by the frontend's gov-records
panel: owner, situs address, acreage, last deed date, total
appraised + assessed values, presence of a mortgage.

What we extract / why:
  - geo_id            primary join key against listing addresses
  - prop_id           internal PACS ID; useful when joining to
                      LAND_DET.TXT (deferred — needs separate pass)
  - owner_name        spotting LLC/holding-company owners (motivated
                      seller signal)
  - situs_address     forward-geocode target for joining to listings
  - legal_acreage     ground truth for parcel size (often more
                      accurate than what the listing states)
  - deed_dt           "last sale date" — TX is non-disclosure so we
                      don't get the price, but the date is recorded
  - mortgage_co       presence/absence of a recorded loan
  - appraised_val     county estimate (for context, not the price)
  - assessed_val      taxable basis after exemptions

All other PROP.TXT fields (exemption flags, jan1 owner, mortgage
account, ARB protest, etc.) are intentionally dropped to keep the
output JSON small. Add fields here only when they earn UI surface.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

# ── PROP.TXT layout (Tyler PACS Legacy 8.0.32). Column positions are
#    1-indexed inclusive, matching the layout doc verbatim so future
#    edits can grep the doc and find the same numbers here.
#    Subtract 1 from `start` for Python's 0-indexed slicing; `end` is
#    inclusive and matches Python's exclusive `end` (1→0, end→end).
PROP_FIELDS: dict[str, tuple[int, int]] = {
    "prop_id":          (1,    12),
    "prop_type_cd":     (13,   17),
    "prop_val_yr":      (18,   22),
    "sup_num":          (23,   34),
    "geo_id":           (547,  596),
    "py_owner_name":    (609,  678),
    "situs_street_prefx": (1040, 1049),
    "situs_street":     (1050, 1099),
    "situs_street_suffix": (1100, 1109),
    "situs_city":       (1110, 1139),
    "situs_zip":        (1140, 1149),
    "legal_acreage":    (1660, 1675),
    "land_hstd_val":    (1796, 1810),
    "land_non_hstd_val": (1811, 1825),
    "imprv_hstd_val":   (1826, 1840),
    "imprv_non_hstd_val": (1841, 1855),
    "appraised_val":    (1916, 1930),
    "assessed_val":     (1946, 1960),
    "deed_book_id":     (1994, 2013),
    "deed_book_page":   (2014, 2033),
    "deed_dt":          (2034, 2058),
    "mortage_co_name":  (2071, 2140),  # PACS schema typo preserved
}


def _slice(line: str, start_end: tuple[int, int]) -> str:
    """Slice a 1-indexed inclusive range from a PACS line and strip
    trailing padding spaces. PACS pads every char field with spaces
    out to its declared length."""
    s, e = start_end
    return line[s - 1 : e].strip()


def _f(line: str, key: str) -> str:
    return _slice(line, PROP_FIELDS[key])


def _to_int(v: str) -> int | None:
    v = v.strip()
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return None


def _to_float(v: str) -> float | None:
    """PACS numeric(N,scale) fields are printed with implied decimal —
    `legal_acreage` is numeric(16,4) → 4 implied decimal places (e.g.
    `0000000010005000` = 1.0005 ac). Valuations are numeric(15) with
    no implied decimal. Caller picks the right divisor; this just
    normalizes the digit string to a Python float."""
    v = v.strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _to_acreage(v: str) -> float | None:
    """legal_acreage is numeric(16,4) — 4 implied decimal places."""
    raw = _to_float(v)
    return None if raw is None else round(raw / 10_000, 4)


def _to_date(v: str) -> str | None:
    """Deed dates ship as "YYYY-MM-DD HH:MM:SS" or empty. Normalize
    to ISO YYYY-MM-DD; drop unparseable values."""
    v = v.strip()
    if not v or v.startswith("0000"):
        return None
    # Travis CAD ships deed_dt as "MM-DD-YYYY" with right-padded
    # spaces (no time component). Other PACS deployments use the
    # SQL-style "YYYY-MM-DD HH:MM:SS" — accept both for portability.
    for fmt in ("%m-%d-%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_prop_line(line: str) -> dict[str, Any] | None:
    """Parse one PROP.TXT line into the compact summary record we
    persist. Returns None for non-Real-Property rows so the output
    file stays focused on parcels (drops Business Personal, Mobile
    Home, Mineral, Auto from the type table)."""
    prop_type = _f(line, "prop_type_cd")
    if prop_type != "R":
        return None

    geo_id = _f(line, "geo_id")
    if not geo_id:
        return None

    address_parts = [
        _f(line, "situs_street_prefx"),
        _f(line, "situs_street"),
        _f(line, "situs_street_suffix"),
    ]
    address = " ".join(p for p in address_parts if p).strip()
    city = _f(line, "situs_city")
    zipcode = _f(line, "situs_zip")

    return {
        "geoId": geo_id,
        "propId": _to_int(_f(line, "prop_id")),
        "valYear": _to_int(_f(line, "prop_val_yr")),
        "owner": _f(line, "py_owner_name"),
        "address": address,
        "city": city,
        "zip": zipcode,
        "acreage": _to_acreage(_f(line, "legal_acreage")),
        "landValue": _to_float(_f(line, "land_hstd_val") or "0") or 0,
        "landNonHstdValue": _to_float(_f(line, "land_non_hstd_val") or "0") or 0,
        "improvementValue": (
            (_to_float(_f(line, "imprv_hstd_val") or "0") or 0)
            + (_to_float(_f(line, "imprv_non_hstd_val") or "0") or 0)
        ),
        "appraisedValue": _to_float(_f(line, "appraised_val") or "0") or 0,
        "assessedValue": _to_float(_f(line, "assessed_val") or "0") or 0,
        "lastDeedDate": _to_date(_f(line, "deed_dt")),
        "deedBook": _f(line, "deed_book_id") or None,
        "deedPage": _f(line, "deed_book_page") or None,
        "mortgageCompany": _f(line, "mortage_co_name") or None,
    }


def stream_prop(zip_path: Path) -> int:
    """Stream PROP.TXT from inside the bulk ZIP without extracting,
    parse each line, and yield-print progress every 100k records."""
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open("PROP.TXT") as raw:
            # PACS exports are latin-1 — TX names + addresses include
            # the occasional accented char that's not valid UTF-8.
            text = io.TextIOWrapper(raw, encoding="latin-1", errors="replace")
            for line in text:
                count += 1
                rec = parse_prop_line(line)
                if rec is not None:
                    yield rec
                if count % 100_000 == 0:
                    print(f"  scanned {count:,} lines …", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, type=Path,
                    help="Path to the Travis CAD bulk export ZIP.")
    ap.add_argument("--out", required=True, type=Path,
                    help="Output JSON file (parcels keyed by geo_id).")
    ap.add_argument("--limit", type=int, default=0,
                    help="Cap parsed records (debug; 0 = no cap).")
    args = ap.parse_args()

    if not args.zip.exists():
        print(f"missing ZIP: {args.zip}", file=sys.stderr)
        return 1

    parcels: dict[str, dict[str, Any]] = {}
    duplicates = 0
    n = 0
    for rec in stream_prop(args.zip):
        gid = rec["geoId"]
        # Multiple owner records per parcel (UDI/partial owners). Keep
        # the first; if a later row has a non-blank owner where the
        # current one is blank, prefer the later row.
        if gid in parcels:
            duplicates += 1
            existing = parcels[gid]
            if not existing.get("owner") and rec.get("owner"):
                parcels[gid] = rec
        else:
            parcels[gid] = rec
        n += 1
        if args.limit and n >= args.limit:
            break

    print(f"unique parcels (real property): {len(parcels):,}", file=sys.stderr)
    print(f"duplicate-owner rows merged:    {duplicates:,}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(parcels, separators=(",", ":")))
    size_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"wrote {args.out} ({size_mb:.1f} MB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
