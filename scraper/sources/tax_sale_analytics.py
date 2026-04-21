"""Derived analytics for tax-sale parcels.

Turns the raw-field dict produced by a tax-sale parser into an enriched
record by extracting parcel type (town lot vs rural acreage) from the
legal description, pulling an acreage estimate where the description
carries one, pricing the parcel against county-median $/acre from our
LandWatch corpus, and computing an investment multiple.

The analytics are deliberately conservative: when a signal is missing
we surface None rather than guess. The UI uses that to gray the pill.

Outputs attached to each tax-sale row's `taxSale` dict:
    parcelType            — 'town_lot' | 'rural' | 'acreage' | 'unknown'
    estimatedAcres        — float | None
    estimatedValueUsd     — float | None (median $/acre × acres)
    investmentMultiple    — float | None
                            (deed: estValue / minBid; lien: redemption-weighted)
    expectedReturnPct     — float | None (annualized %, for lien states)
    analyticsNotes        — list[str] of human-readable reasons
"""

from __future__ import annotations

import re
from collections import defaultdict
from statistics import median
from typing import Any, Iterable

# ── parcel-type classification ──────────────────────────────────────────────

# PLSS section/township/range notation strongly implies rural acreage:
# "SEC 14 T55N R99W", "T55 R99", "SECTION 14", etc.
_PLSS_RE = re.compile(
    r"\b(?:SEC(?:TION|T|\.)?\s*\d+|T\d{1,3}[NS]?\s*R\d{1,3}[EW]?|T\s*\d+\s*R\s*\d+)\b",
    re.IGNORECASE,
)

# Platted / subdivided town-lot notation: "LOT 8 BLK. 106", "BLOCK 5"
_TOWN_LOT_RE = re.compile(
    r"\b(?:LOT\s+[A-Z0-9]+\s+BLK|BLOCK\s+\d+|LOT\s+\d+\s+OF)\b",
    re.IGNORECASE,
)


def extract_parcel_type(legal_description: str) -> str:
    """Classify a parcel from its legal description. Returns one of:
    - 'acreage' — an explicit AC/ACRES figure is present (most actionable)
    - 'rural'   — PLSS (sec/twn/rng) markers present, no acreage stated
    - 'town_lot' — lot/block notation only
    - 'unknown' — nothing classifiable
    """
    if not legal_description:
        return "unknown"
    has_acres = _ACRES_RE.search(legal_description) is not None
    has_plss = _PLSS_RE.search(legal_description) is not None
    has_town_lot = _TOWN_LOT_RE.search(legal_description) is not None

    if has_acres:
        return "acreage"
    if has_plss and not has_town_lot:
        return "rural"
    if has_town_lot:
        return "town_lot"
    return "unknown"


# ── acreage extraction ──────────────────────────────────────────────────────

# Match "1.85 AC", "55 ACRES", "10.0 AC.", "160 AC,"
_ACRES_RE = re.compile(
    r"(?P<n>\d{1,5}(?:\.\d+)?)\s*(?:AC(?:RE)?S?)\b",
    re.IGNORECASE,
)


def extract_acres(legal_description: str) -> float | None:
    """Pull an explicit acreage figure out of a legal description. Returns
    the LARGEST match (legal descs often list parent-tract acreage first,
    with smaller sub-tracts later)."""
    if not legal_description:
        return None
    matches = [float(m.group("n")) for m in _ACRES_RE.finditer(legal_description)]
    if not matches:
        return None
    # Cap at 640 — a township section. Anything larger is almost always a
    # transcription artifact in these terse PDF descriptions.
    matches = [m for m in matches if 0 < m <= 640]
    if not matches:
        return None
    return max(matches)


# ── $/acre median from LandWatch corpus ─────────────────────────────────────


def compute_county_ppa_medians(
    listings: Iterable[dict[str, Any]],
) -> dict[tuple[str, str], float]:
    """Return {(state, county): median $/acre} computed from LandWatch-style
    listings (needs a positive pricePerAcre and acreage > 0). Ignores
    tax-sale rows so they don't bias the number.
    """
    buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
    for item in listings:
        if item.get("source") == "county_tax":
            continue
        acreage = float(item.get("acreage") or 0)
        ppa = float(item.get("pricePerAcre") or 0)
        if acreage <= 0 or ppa <= 0:
            continue
        loc = item.get("location") or {}
        state = str(loc.get("state") or "").upper()
        county = str(loc.get("county") or "").strip()
        if not state or not county:
            continue
        buckets[(state, county)].append(ppa)
    return {key: median(vals) for key, vals in buckets.items() if len(vals) >= 2}


# ── investment multiple (deed states) / expected return (lien states) ──────

# Rough pad for post-sale costs: attorney, title, quiet-title action,
# recording fees. $5k is conservative for rural; urban lots can be more.
_DEED_POST_SALE_COSTS_USD = 5000.0

# Wyoming tax-lien certificates earn 15% simple interest to the holder
# until redemption. Empirical redemption rate is high (~85-90% across
# lien states). We weight the investment accordingly. Redemption
# probability bends with the owed-to-value ratio: a $50 lien on a
# $50k parcel is ~100% certain to redeem; a $30k lien on a $50k
# distressed parcel is much less certain.
_LIEN_BASELINE_REDEMPTION_RATE = 0.85
_LIEN_AVG_REDEMPTION_MONTHS = 14  # across the 3-yr window

# Ceiling on the reported expected return. The formula blows up when
# a tiny owed amount sits on a large high-value parcel (divides by a
# very small bid). In reality, owners almost always redeem such liens,
# so the "what if they don't" upside is statistical noise. Cap at a
# number that still communicates "this is obviously worth a look."
_LIEN_RETURN_CAP_PCT = 500.0


def compute_deed_investment_multiple(
    min_bid: float, est_value: float | None
) -> float | None:
    """Conservative deed-state multiple: (est_value - min_bid - costs) / min_bid.
    Returns None when we lack a value estimate."""
    if est_value is None or min_bid <= 0:
        return None
    net_upside = est_value - min_bid - _DEED_POST_SALE_COSTS_USD
    return round(net_upside / min_bid, 2)


def _adjusted_redemption_rate(min_bid: float, est_value: float | None) -> float:
    """Redemption rate bends with the owed-to-value ratio. Owners virtually
    always redeem small liens on valuable parcels (they'd lose the land
    for pennies). They're more likely to walk away from large liens on
    marginal parcels."""
    if est_value is None or est_value <= 0:
        return _LIEN_BASELINE_REDEMPTION_RATE
    ratio = min_bid / est_value
    if ratio < 0.01:
        return 0.99  # near-certain redemption
    if ratio < 0.05:
        return 0.95
    if ratio < 0.15:
        return _LIEN_BASELINE_REDEMPTION_RATE
    if ratio < 0.40:
        return 0.70
    return 0.55  # big lien on marginal land — owner may walk


def compute_lien_expected_return_pct(
    min_bid: float,
    est_value: float | None,
    annual_rate: float = 0.15,
    redemption_rate: float | None = None,
    avg_months_to_redemption: int = _LIEN_AVG_REDEMPTION_MONTHS,
) -> float | None:
    """Annualized expected return on a tax-lien certificate.

    return = P(redeem) * (annual statutory rate)
           + P(no redeem) * (max(est_value - min_bid - quiet_title_costs, 0) / min_bid / 3yr)

    P(redeem) scales with owed/estValue ratio by default — tiny liens on
    valuable parcels are near-certain to redeem. The overall result is
    capped at _LIEN_RETURN_CAP_PCT to keep edge cases legible.
    """
    if min_bid <= 0:
        return None
    if redemption_rate is None:
        redemption_rate = _adjusted_redemption_rate(min_bid, est_value)
    redeemed_yield_annual = annual_rate * (avg_months_to_redemption / 12.0)
    if est_value is None:
        return round(redemption_rate * redeemed_yield_annual * 100, 1)
    deed_net = max(est_value - min_bid - _DEED_POST_SALE_COSTS_USD, 0.0)
    non_redeem_annual = (deed_net / min_bid) / 3.0  # ~3yr redemption window
    weighted = (
        redemption_rate * redeemed_yield_annual
        + (1 - redemption_rate) * non_redeem_annual
    )
    return round(min(weighted * 100, _LIEN_RETURN_CAP_PCT), 1)


# ── orchestration ──────────────────────────────────────────────────────────


def analyze(
    tax_sale: dict[str, Any],
    county_median_ppa: dict[tuple[str, str], float] | None = None,
) -> dict[str, Any]:
    """Enrich a taxSale dict in place with analytics fields.

    Returns the same dict (mutated) for caller convenience. Safe to call
    multiple times — always recomputes.
    """
    notes: list[str] = []
    legal = tax_sale.get("legalDescription") or ""
    parcel_type = extract_parcel_type(legal)
    acres = extract_acres(legal)
    state = str(tax_sale.get("state") or "").upper() or None
    county = str(tax_sale.get("county") or "").strip()
    state_type = tax_sale.get("stateType") or "lien"
    min_bid = float(tax_sale.get("amountOwedUsd") or 0)

    est_value: float | None = None
    if (
        acres is not None
        and county_median_ppa is not None
        and state
        and (state, county) in county_median_ppa
    ):
        ppa = county_median_ppa[(state, county)]
        est_value = round(acres * ppa, 0)
        notes.append(
            f"Est. value: {acres:.2f} AC × ${ppa:,.0f}/ac median for "
            f"{county} Co = ${est_value:,.0f}"
        )
    elif acres is not None and county_median_ppa is not None and state:
        # Fall back to state-wide median if county has no LandWatch sample
        state_samples = [v for (s, _), v in county_median_ppa.items() if s == state]
        if state_samples:
            ppa = median(state_samples)
            est_value = round(acres * ppa, 0)
            notes.append(
                f"Est. value: {acres:.2f} AC × ${ppa:,.0f}/ac median for "
                f"{state} (no {county} Co sample) = ${est_value:,.0f}"
            )

    multiple: float | None = None
    return_pct: float | None = None
    if state_type == "deed":
        multiple = compute_deed_investment_multiple(min_bid, est_value)
        if multiple is not None:
            notes.append(
                f"Deed state: net upside ≈ {multiple}× minimum bid "
                f"after ~${_DEED_POST_SALE_COSTS_USD:,.0f} in title/legal costs"
            )
    else:
        return_pct = compute_lien_expected_return_pct(min_bid, est_value)
        if return_pct is not None:
            redemption_rate = _adjusted_redemption_rate(min_bid, est_value)
            notes.append(
                f"Lien state: ~{return_pct}%/yr expected return (weighted "
                f"for {int(redemption_rate * 100)}% redemption probability; "
                f"capped at {int(_LIEN_RETURN_CAP_PCT)}%)"
            )

    # Human-readable parcel-type guidance
    if parcel_type == "town_lot":
        notes.append(
            "Town lot — likely inherits any structures and town-lot restrictions"
        )
    elif parcel_type == "rural":
        notes.append("Rural PLSS parcel — check road access and water rights")
    elif parcel_type == "acreage":
        notes.append(
            f"Acreage stated: {acres:.2f} AC"
            if acres
            else "Acreage stated in legal description"
        )

    tax_sale["parcelType"] = parcel_type
    tax_sale["estimatedAcres"] = acres
    tax_sale["estimatedValueUsd"] = est_value
    tax_sale["investmentMultiple"] = multiple
    tax_sale["expectedReturnPct"] = return_pct
    tax_sale["analyticsNotes"] = notes
    return tax_sale


def analyze_listings(listings: list[dict[str, Any]]) -> None:
    """Run analytics across an entire listings list (mutates in place).

    Computes $/acre medians from the non-tax-sale rows first, then stamps
    analytics fields onto every tax-sale row. Idempotent — safe to re-run.
    """
    ppa_medians = compute_county_ppa_medians(listings)
    for item in listings:
        if item.get("status") != "tax_sale":
            continue
        tax_sale = item.get("taxSale")
        if not isinstance(tax_sale, dict):
            continue
        analyze(tax_sale, ppa_medians)
