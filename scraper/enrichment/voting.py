"""County-level political-lean enrichment.

Joins each listing's `(state, county)` pair against a vendored
JSON of presidential vote shares (`data/voting_county.json`).
Adds a `votingPattern` field carrying year, D/R percentages,
absolute margin in pp, and a coarse bucket (`strongly_d` …
`strongly_r`) the frontend can filter on.

Pure-Python, offline, idempotent. Re-runs are free.

Recommended canonical data source for the JSON file:
  MIT Election Lab — county_president_general dataset.
  https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ
The vendored file ships with a ~20-county seed for MO + AR; the
operator should replace it with a full national conversion before
launch.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("voting")


_DEFAULT_PATH = config.DATA_DIR / "voting_county.json"


def _normalize_county(name: str | None) -> str:
    """Normalize a county name to the form used as a key in
    `voting_county.json`. Strips the 'County' / 'Parish' / 'Borough' /
    'Census Area' / 'Municipality' suffix, removes dots so 'St. Louis'
    and 'St Louis' collapse to the same key, lowercases."""
    if not name:
        return ""
    s = name.strip()
    # Strip variant suffixes (Alaska boroughs and census areas, LA
    # parishes, plus the standard County). Order: longest first so
    # "City and Borough" matches before "Borough".
    s = re.sub(
        r"\s+(City and Borough|Census Area|Municipality|Borough|Parish|County)\s*$",
        "",
        s,
        flags=re.IGNORECASE,
    )
    # Remove periods so "St. Louis" and "St Louis" collapse together.
    s = s.replace(".", "")
    # Collapse internal whitespace.
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def _bucket(margin_pp: float) -> str:
    """Map signed margin (positive = R) to a coarse filter bucket."""
    if margin_pp >= 20:
        return "strongly_r"
    if margin_pp >= 5:
        return "lean_r"
    if margin_pp <= -20:
        return "strongly_d"
    if margin_pp <= -5:
        return "lean_d"
    return "balanced"


def load_table(path: Path = _DEFAULT_PATH) -> dict[str, dict[str, Any]]:
    """Load the vendored JSON, dropping the leading `_meta` block.

    Returns a dict keyed by `<STATE>|<county-lowercased-no-suffix>`."""
    if not path.exists():
        log.info(f"[voting] no data file at {path}; enrichment is a no-op")
        return {}
    raw = json.loads(path.read_text())
    out: dict[str, dict[str, Any]] = {}
    for k, v in raw.items():
        if k.startswith("_"):
            continue
        if not isinstance(v, dict):
            continue
        out[k] = v
    return out


def enrich(
    listings: list[dict[str, Any]],
    *,
    table: dict[str, dict[str, Any]] | None = None,
    overwrite: bool = False,
) -> int:
    """Stamp `votingPattern` onto each listing whose (state, county)
    matches a row in the table. Returns the number of rows touched.

    Skips listings that already have a votingPattern unless
    `overwrite=True` — re-running is cheap because of this gate.
    """
    if table is None:
        table = load_table()
    if not table:
        return 0
    touched = 0
    for item in listings:
        if "votingPattern" in item and not overwrite:
            continue
        loc = item.get("location") or {}
        state = (loc.get("state") or "").strip().upper()
        county = _normalize_county(loc.get("county"))
        if not state or not county:
            continue
        row = table.get(f"{state}|{county}")
        if not row:
            continue
        d = float(row.get("dPct", 0))
        r = float(row.get("rPct", 0))
        margin = r - d
        item["votingPattern"] = {
            "year": int(row.get("year", 0)),
            "dPct": round(d, 2),
            "rPct": round(r, 2),
            "marginPp": round(margin, 2),
            "bucket": _bucket(margin),
        }
        touched += 1
    return touched


def main() -> None:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Stamp county voting patterns onto listings")
    parser.add_argument("--input", type=Path, default=config.DATA_DIR / "listings.json")
    parser.add_argument("--data", type=Path, default=_DEFAULT_PATH)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Input missing: {args.input}", file=sys.stderr)
        sys.exit(1)
    listings = json.loads(args.input.read_text())
    table = load_table(args.data)
    n = enrich(listings, table=table, overwrite=args.overwrite)
    args.input.write_text(json.dumps(listings, indent=2))
    print(f"Stamped votingPattern on {n}/{len(listings)} listings")


if __name__ == "__main__":
    main()
