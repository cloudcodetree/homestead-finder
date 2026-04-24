"""Detect improvements (house, cabin, well, septic, electric, barn, etc.) in
a listing's title + description, estimate their value, and compute a
residual land price for fair $/acre comparison.

Why this module exists: the deal scorer uses $/acre to rank. A 20-acre
listing with a 3br house asking $200k ($10k/acre) looks worse than a
20-acre bare parcel at $80k ($4k/acre) even though the first one
delivers a place to LIVE right now. The residual-price approach
subtracts a rough structure value from the asking price before computing
$/acre — so the per-acre value of the LAND is what gets compared.

Values are deliberately conservative. A cabin-on-40-acres listing is
unlikely to overestimate raw land value, but might under-reward the
structure. That's fine — understatement is safer than overstatement when
the output feeds a deal-ranker. A reviewer can always look at the card.

Usage:
    python -m scraper.improvements             # run against data/listings.json
    python -m scraper.improvements --dry-run   # compute + print, don't write
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("improvements")


# ── Detection patterns ──────────────────────────────────────────────
# Each entry: (key, [phrase-match patterns], estimated value USD).
# Values come from rural-Ozark rule-of-thumb: stick-built home $120k;
# cabin/mobile $45k; basic well+septic+electric bundle $18k; each
# outbuilding $10-15k. Deliberately on the low side so residual price
# isn't manipulatively inflated. Patterns are run against lowercase text;
# word boundaries keep "well-kept" from matching "well".

_PATTERNS: list[tuple[str, list[str], int]] = [
    # Primary structures — ordered most-valuable first so we can short
    # circuit and not double-count (e.g. if "home" matches we skip
    # "cabin" detection for a single-home listing).
    (
        "home",
        [
            r"\bhouse\b",
            r"\bhome\b(?!\s*site)",  # "home" but not "homesite"
            r"\bresidence\b",
            r"\bdwelling\b",
            r"\bfarmhouse\b",
            r"\branch\s*house\b",
            r"\b\d+\s*(?:br|bed)(?:room)?s?\b",  # "3br", "4 bedrooms"
            r"\b\d+\s*(?:ba|bath)(?:room)?s?\b",
        ],
        120_000,
    ),
    (
        "cabin",
        [
            r"\bcabin\b",
            r"\bmobile\s*home\b",
            r"\bmanufactured\s*home\b",
            r"\bsingle[-\s]?wide\b",
            r"\bdouble[-\s]?wide\b",
            r"\btrailer\b(?!\s*park)",
            r"\brv\s*hookup\b",
            r"\btiny\s*home\b",
            r"\bcottage\b",
        ],
        45_000,
    ),
    (
        "barn",
        [
            r"\bbarn\b",
            r"\bpole\s*barn\b",
            r"\bshop\b(?!ping)",  # "shop" but not "shopping"
            r"\bworkshop\b",
            r"\bequipment\s*shed\b",
            r"\bmachine\s*shed\b",
            r"\bhay\s*barn\b",
        ],
        15_000,
    ),
    (
        "outbuilding",
        [
            r"\boutbuilding\b",
            r"\bshed\b",
            r"\bgarage\b",
            r"\bcarport\b",
            r"\bchicken\s*coop\b",
            r"\bstorage\s*building\b",
            r"\bstructure[s]?\b",
        ],
        8_000,
    ),
    # Utilities — not structures, but substantial sunk cost the buyer
    # doesn't have to spend. Well drilling in the Ozarks runs $6-12k;
    # septic install $8-12k; electric service drop $3-8k.
    (
        "well",
        [
            r"\bwell\b(?!\s*kept|\s*maintained)",
            r"\bdrilled\s*well\b",
            r"\bwater\s*well\b",
            r"\bprivate\s*well\b",
        ],
        10_000,
    ),
    (
        "septic",
        [
            r"\bseptic\b",
            r"\blagoon\b",
            r"\bseptic\s*system\b",
        ],
        9_000,
    ),
    (
        "electric",
        [
            r"\belectric(?:ity|al)?\b",
            r"\bpower\s*on\s*(?:site|property)\b",
            r"\butilities\b",
            r"\bpower\s*pole\b",
            r"\bgrid\b",
        ],
        5_000,
    ),
    (
        "water_city",
        [
            r"\bcity\s*water\b",
            r"\brural\s*water\b",
            r"\bpublic\s*water\b",
            r"\bmunicipal\s*water\b",
        ],
        5_000,
    ),
]


# ── Detection ──────────────────────────────────────────────────────


def detect_improvements(text: str) -> dict[str, bool]:
    """Given title + description text, return a dict keyed by improvement
    type → True when detected. Multiple outbuildings collapse to one
    flag (we count value once; sellers rarely itemize)."""
    if not text:
        return {}
    text_lc = text.lower()
    found: dict[str, bool] = {}
    seen_keys: set[str] = set()
    for key, patterns, _value in _PATTERNS:
        for pat in patterns:
            if re.search(pat, text_lc):
                found[key] = True
                seen_keys.add(key)
                break
    # De-dupe: if "home" was detected, suppress "cabin" (same slot).
    if "home" in seen_keys and "cabin" in seen_keys:
        found.pop("cabin", None)
    return found


def estimate_structure_value(improvements: dict[str, bool]) -> int:
    """Sum conservative per-improvement values into a total $ estimate.
    Home and cabin both contribute up to ONE primary-structure value;
    utilities and outbuildings stack."""
    total = 0
    # Primary structure — home trumps cabin if both present
    if improvements.get("home"):
        total += _value_for("home")
    elif improvements.get("cabin"):
        total += _value_for("cabin")
    # Others stack
    for key in ("barn", "outbuilding", "well", "septic", "electric", "water_city"):
        if improvements.get(key):
            total += _value_for(key)
    return total


def _value_for(key: str) -> int:
    for k, _pats, v in _PATTERNS:
        if k == key:
            return v
    return 0


# ── Move-in-ready rubric ───────────────────────────────────────────
# A listing is "move-in ready" when it has the minimum necessary
# infrastructure to sleep there tonight: primary dwelling + water +
# septic. Electric is implied on a modern home but we check explicitly
# for completeness. If any of these are missing, it's a build project.


def is_move_in_ready(improvements: dict[str, bool]) -> bool:
    """A listing is move-in ready when dwelling + water are present.

    We used to also require explicit septic detection, but 99% of
    occupied rural homes have septic — listings just rarely spell it
    out ("3br ranch on 10 acres" implies septic without mentioning).
    Requiring explicit septic dropped the move-in-ready count to
    effectively zero against live data, which was unusable.

    City-water homes always have city sewer; well-water homes almost
    always have septic. So water presence is a sufficient proxy.
    """
    has_dwelling = bool(improvements.get("home") or improvements.get("cabin"))
    has_water = bool(improvements.get("well") or improvements.get("water_city"))
    return has_dwelling and has_water


# ── Build-out cost estimator ───────────────────────────────────────
# For bare or partially-improved land, estimate what the buyer would
# need to spend to get to move-in-ready. Feeds the Total Cost view.


def estimate_buildout_cost(improvements: dict[str, bool]) -> int:
    """Return an estimated USD cost to bring this parcel to move-in-ready
    from its current state. Zero when already move-in-ready."""
    if is_move_in_ready(improvements):
        return 0
    cost = 0
    if not (improvements.get("home") or improvements.get("cabin")):
        # Modest modular / small cabin build-out. Stick-built averages
        # much higher ($250k+) but many homesteaders set an RV or build
        # a 600sqft cabin for $40-60k in materials.
        cost += 55_000
    if not (improvements.get("well") or improvements.get("water_city")):
        cost += 10_000
    if not improvements.get("septic"):
        cost += 9_000
    if not improvements.get("electric") and not improvements.get("water_city"):
        # On-grid parcel missing utility hookup — solar setup costs.
        # If no electric at all, assume they'll go off-grid solar.
        cost += 12_000
    return cost


# ── Top-level enrichment pass ──────────────────────────────────────


def enrich_one(listing: dict[str, Any]) -> dict[str, Any]:
    """Compute structure detection, residual land price, move-in-ready
    flag, and build-out estimate for a single listing dict. Mutates in
    place + returns for convenience."""
    text = " ".join(
        [
            str(listing.get("title") or ""),
            str(listing.get("description") or ""),
        ]
    )
    improvements = detect_improvements(text)
    struct_value = estimate_structure_value(improvements)
    price = float(listing.get("price") or 0)
    acreage = float(listing.get("acreage") or 0)

    # Residual land price = asking − estimated structure value, floored
    # at 10% of asking so we never produce an absurd negative or
    # near-zero land price on a cabin-heavy listing.
    residual_price = max(price * 0.10, price - struct_value) if price > 0 else 0
    residual_ppa = (residual_price / acreage) if acreage > 0 else 0

    listing["improvements"] = {
        k: True for k, v in improvements.items() if v
    }
    listing["estimatedStructureValueUsd"] = struct_value
    listing["residualLandPrice"] = round(residual_price, 2)
    listing["residualPricePerAcre"] = round(residual_ppa, 2)
    listing["moveInReady"] = is_move_in_ready(improvements)
    listing["estimatedBuildoutUsd"] = estimate_buildout_cost(improvements)
    return listing


def enrich_all(
    path: Path, *, dry_run: bool = False
) -> tuple[int, int, int]:
    """Run the detector against every listing in listings.json. Returns
    (total, move_in_ready_count, with_structures_count)."""
    data = json.loads(path.read_text())
    if not isinstance(data, list):
        return 0, 0, 0
    move_in = 0
    with_structures = 0
    for row in data:
        enrich_one(row)
        if row.get("moveInReady"):
            move_in += 1
        if row.get("estimatedStructureValueUsd", 0) > 0:
            with_structures += 1
    if not dry_run:
        path.write_text(json.dumps(data, indent=2))
    return len(data), move_in, with_structures


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--path",
        default=str(config.DATA_DIR / "listings.json"),
        help="Path to listings.json",
    )
    args = ap.parse_args()
    total, mir, struct = enrich_all(Path(args.path), dry_run=args.dry_run)
    print(
        f"[improvements] {total} listings · "
        f"{struct} with detected improvements · "
        f"{mir} move-in-ready"
    )


if __name__ == "__main__":
    main()
