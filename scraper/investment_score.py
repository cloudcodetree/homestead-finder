"""InvestmentScore — multi-axis investment-grade index for listings.

Composes five tunable axes into a single 0-100 score with a transparent
breakdown the frontend can render as a stacked bar / radar chart:

    Value      — price vs county/state comps
    Land       — physical fundamentals (soil, flood, slope, water access)
    Risk       — red flags, infrastructure gaps, hazards
    Liquidity  — how easy to exit (comps depth, days on market)
    Macro      — county tailwind (population trend, unemployment, tax burden)

Each axis is computed independently from the listing record + a `context`
dict (medians, macro lookups). Results layer onto the listing as
`investmentScore` (the composite 0-100) and `investmentBreakdown` (an
ordered list of axis dicts with score / weight / contributing signals).

The axis list shape — `[{key, label, score, weight, signals}, ...]` —
is intentional. It keeps each user's preferred ordering / reweighting
trivial: persist `[(key, weight)]` per user, recompose at read time.
Don't refactor to a flat dict.

Pure-Python, offline, fast (<1ms per listing). Idempotent — running
again with unchanged inputs produces identical output.

Usage (one-shot pass over listings.json):
    python -m scraper.investment_score
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("investment_score")


# ── Default axis weights ────────────────────────────────────────────
# Phase 1 weights (no Macro data): redistribute Macro's slot across
# Value + Risk so the composite still sums to 1.0.
# Phase 2 weights (Macro data present): shave 5pp off Value/Risk for it.
#
# TODO(ai-enrich): these are gut-feel defaults. Two upgrade paths:
#   1. Per-user weights — let the user reorder the axes (see
#      feedback_visualize_data memory: "they can maybe order the
#      stack of it like weights"). Persist to user_preferences.
#   2. Learned weights — once we have enough save/hide/rating signal,
#      the rank_fit-style trainer can fit the weights that maximize
#      agreement with user actions (e.g. saved listings have higher
#      composite than hidden ones).
_PHASE1_WEIGHTS: dict[str, float] = {
    "value": 0.35,
    "land": 0.30,
    "risk": 0.25,
    "liquidity": 0.10,
    "macro": 0.0,  # disabled until macro data ships
}
_PHASE2_WEIGHTS: dict[str, float] = {
    "value": 0.25,
    "land": 0.25,
    "risk": 0.20,
    "liquidity": 0.10,
    "macro": 0.20,
}


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _signal(label: str, weight: float, value: str | float | None) -> dict[str, Any]:
    """Compact representation of a single contributing signal so the
    frontend breakdown can show what fed each axis without recomputing."""
    return {"label": label, "weight": round(weight, 2), "value": value}


# ── Value axis ──────────────────────────────────────────────────────
def score_value(
    listing: dict[str, Any],
    county_medians: dict[str, float],
    state_medians: dict[str, float],
) -> tuple[float, list[dict[str, Any]]]:
    """100 = priced well below comps, 50 = at median, 0 = >2× median."""
    ppa = listing.get("pricePerAcre") or 0.0
    if ppa <= 0:
        return 50.0, [_signal("No price-per-acre", 0, None)]
    loc = listing.get("location") or {}
    state = (loc.get("state") or "").upper()
    county = (loc.get("county") or "").strip()
    key = f"{state}|{county.lower().replace(' county', '').strip()}"

    median = county_medians.get(key)
    source_label = "county"
    if median is None or median <= 0:
        median = state_medians.get(state)
        source_label = "state"
    if median is None or median <= 0:
        # No reference — give a neutral score rather than penalize.
        return 50.0, [_signal("No comp baseline available", 0, None)]

    ratio = ppa / median
    # Sigmoid mapping centered at 1.0 (median): 0.5× → ~85, 1.0× → 50,
    # 2.0× → ~15. Asymmetric: rewards undervaluation more than it
    # punishes overvaluation, since rural land has wide variance.
    # Clamp ratio first to keep math.exp from overflowing on extreme
    # outliers (e.g. a $1M/ac listing in a $1k/ac county).
    bounded = max(-50.0, min(50.0, 2.0 * (ratio - 1.0)))
    score = 100.0 / (1.0 + math.exp(bounded))
    score = _clamp(score)

    signals = [
        _signal(f"$/acre vs {source_label} median", 1.0, f"{ratio:.2f}× median"),
        _signal(f"Listing $/acre", 0.5, f"${ppa:,.0f}"),
        _signal(f"{source_label.title()} median", 0.5, f"${median:,.0f}"),
    ]
    return score, signals


# ── Land axis ───────────────────────────────────────────────────────
def score_land(listing: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    """100 = great soil, no flood, water nearby. 0 = wetland with no water."""
    geo = listing.get("geoEnrichment") or {}
    soil = geo.get("soil") or {}
    flood = geo.get("flood") or {}
    proximity = geo.get("proximity") or {}

    if not geo:
        # No geo data — neutral score.
        return 50.0, [_signal("Geo enrichment not yet run", 0, None)]

    components: list[tuple[str, float, float]] = []  # (label, weight, points)

    # Soil capability class (1=best ag, 8=non-arable).
    cap = soil.get("capabilityClass")
    try:
        cap_n = int(cap) if cap is not None else None
    except ValueError:
        cap_n = None
    if cap_n is not None:
        # 1 → 100, 4 → 60, 8 → 0. Linear.
        soil_score = max(0.0, 100.0 - (cap_n - 1) * (100.0 / 7.0))
        components.append(("Soil class", 0.30, soil_score))
    else:
        components.append(("Soil class", 0.0, 50.0))

    # Drainage class.
    drain = (soil.get("drainageClass") or "").lower()
    if "well drained" in drain:
        drain_score = 90.0
    elif "moderately well" in drain or "somewhat poorly" in drain:
        drain_score = 60.0
    elif "poorly" in drain or "very poorly" in drain:
        drain_score = 25.0
    else:
        drain_score = 50.0
    components.append(("Drainage", 0.15, drain_score))

    # Slope (low = better for building + ag).
    slope = soil.get("slopePercent")
    if isinstance(slope, (int, float)):
        # 0-5% → 100, 15% → 50, 30%+ → 0.
        slope_score = _clamp(100.0 - (slope * 100.0 / 30.0))
        components.append(("Slope", 0.15, slope_score))

    # Flood frequency.
    flood_freq = (soil.get("floodFrequency") or "").lower()
    if "none" in flood_freq:
        ff_score = 100.0
    elif "rare" in flood_freq:
        ff_score = 70.0
    elif "occasional" in flood_freq:
        ff_score = 35.0
    elif "frequent" in flood_freq:
        ff_score = 5.0
    else:
        ff_score = 60.0
    components.append(("Flood frequency", 0.20, ff_score))

    # FEMA flood zone (X = good, AE = bad, V = worst).
    zone_raw = (flood.get("zone") if flood else "") or ""
    zone_parts = zone_raw.upper().split()
    zone = zone_parts[0] if zone_parts else ""
    if zone == "X":
        fema_score = 100.0
    elif zone in ("A", "AE", "AH", "AO"):
        fema_score = 25.0
    elif zone.startswith("V"):
        fema_score = 5.0
    elif not zone:
        fema_score = 60.0
    else:
        fema_score = 60.0
    components.append(("FEMA flood zone", 0.10, fema_score))

    # Water proximity (count of named water features nearby).
    wf_count = proximity.get("waterFeatureCount") if proximity else None
    if isinstance(wf_count, (int, float)):
        # 0 → 30, 5 → 65, 20+ → 100.
        wf_score = _clamp(30.0 + wf_count * 3.5)
        components.append(("Water features within 5 mi", 0.10, wf_score))

    # Weighted average.
    total_w = sum(w for _, w, _ in components if w > 0)
    if total_w == 0:
        return 50.0, [_signal("Insufficient land data", 0, None)]
    score = sum(w * pts for _, w, pts in components if w > 0) / total_w
    score = _clamp(score)

    signals = [_signal(label, w, f"{pts:.0f}") for label, w, pts in components if w > 0]
    return score, signals


# ── Risk axis ───────────────────────────────────────────────────────
# Each red flag costs N points. Severity-weighted.
#
# TODO(ai-enrich): hand-tuned penalty values from a small calibration
# set. Better signal would come from running Claude over a sample of
# saved-vs-hidden listings paired with their flags — let the model
# infer which flags actually predict user rejection. Until then these
# numbers are the operator's best guess.
_RED_FLAG_PENALTIES: dict[str, int] = {
    "flood_zone": 25,
    "wetland": 20,
    "no_water_source": 15,
    "needs_well": 8,
    "no_road_access": 25,
    "easement_issues": 20,
    "title_issues": 30,
    "structural_issues": 15,
    "hoa_restrictions": 10,
    "deed_restrictions": 10,
    "zoning_issues": 18,
    "mineral_rights_excluded": 12,
    "shared_well": 10,
    "septic_failed": 18,
    "price_seems_too_good": 25,  # often a sign of lease/share/incomplete listing
    "in_floodplain": 22,
    "fire_risk": 18,
    "contamination_suspected": 30,
}


def score_risk(listing: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    """100 = no red flags, clean infrastructure. 0 = stacked hazards."""
    flags = listing.get("redFlags") or []
    score = 100.0
    triggered: list[tuple[str, int]] = []
    for f in flags:
        key = str(f).lower().strip()
        penalty = _RED_FLAG_PENALTIES.get(key, 8)  # default 8 for unknown flags
        score -= penalty
        triggered.append((key, penalty))
    # Soft floor at 5 — a property with every flag should still register
    # as "extremely risky" rather than disappear off the bottom.
    score = max(5.0, score)

    signals = []
    if triggered:
        signals = [_signal(k, 1.0, f"-{p} pts") for k, p in triggered]
    else:
        signals.append(_signal("No red flags", 1.0, "+0 pts"))
    return score, signals


# ── Liquidity axis ──────────────────────────────────────────────────
def score_liquidity(
    listing: dict[str, Any],
    county_comp_counts: dict[str, int],
) -> tuple[float, list[dict[str, Any]]]:
    """100 = thick comps + freshly listed. 0 = thin market + stale."""
    loc = listing.get("location") or {}
    state = (loc.get("state") or "").upper()
    county = (loc.get("county") or "").strip()
    key = f"{state}|{county.lower().replace(' county', '').strip()}"
    n_comps = county_comp_counts.get(key, 0)

    # Comps depth: 0 → 30, 20 → 75, 100+ → 100.
    if n_comps <= 0:
        comps_score = 30.0
    else:
        comps_score = _clamp(30.0 + math.log1p(n_comps) * 18.0)

    dom = listing.get("daysOnMarket")
    # Days on market: 0-30 → fresh inventory in liquid market, 100. 90+
    # → stale, indicates seller can't move it, drops to 40.
    if isinstance(dom, (int, float)) and dom > 0:
        if dom <= 30:
            dom_score = 100.0
        elif dom <= 90:
            dom_score = 100.0 - (dom - 30) * 0.6  # 30→100, 90→64
        elif dom <= 365:
            dom_score = 64.0 - (dom - 90) * 0.08  # 90→64, 365→42
        else:
            dom_score = 35.0
        components = [
            ("Comps depth", 0.6, comps_score),
            ("Days on market", 0.4, dom_score),
        ]
        signals = [
            _signal("Comps in county", 0.6, str(n_comps)),
            _signal("Days on market", 0.4, str(int(dom))),
        ]
    else:
        components = [("Comps depth", 1.0, comps_score)]
        signals = [_signal("Comps in county", 1.0, str(n_comps))]

    total_w = sum(w for _, w, _ in components)
    score = sum(w * pts for _, w, pts in components) / total_w
    return _clamp(score), signals


# ── Macro axis (Phase 2 — gated on macro data presence) ─────────────
def score_macro(
    listing: dict[str, Any],
    macro: dict[str, Any] | None,
) -> tuple[float, list[dict[str, Any]]]:
    """100 = growing population + low unemployment + low tax burden."""
    if not macro:
        return 50.0, [_signal("Macro data not yet ingested", 0, None)]
    loc = listing.get("location") or {}
    state = (loc.get("state") or "").upper()
    county = (loc.get("county") or "").strip()
    key = f"{state}|{county.lower().replace(' county', '').strip()}"

    row = macro.get(key)
    if not row:
        return 50.0, [_signal("No macro row for this county", 0, None)]

    components: list[tuple[str, float, float]] = []
    signals: list[dict[str, Any]] = []

    # Population trend (5-yr % change). +5% → 95, 0% → 60, -5% → 30.
    pop_pct = row.get("popChangePct5yr")
    if isinstance(pop_pct, (int, float)):
        pop_score = _clamp(60.0 + pop_pct * 7.0)
        components.append(("Population trend", 0.4, pop_score))
        signals.append(_signal("Pop change (5yr)", 0.4, f"{pop_pct:+.1f}%"))

    # Unemployment vs national avg (national ~ 4%). 2% → 95, 4% → 60,
    # 8%+ → 25.
    unemp = row.get("unemploymentRate")
    if isinstance(unemp, (int, float)):
        unemp_score = _clamp(120.0 - unemp * 12.0)
        components.append(("Unemployment", 0.3, unemp_score))
        signals.append(_signal("Unemployment", 0.3, f"{unemp:.1f}%"))

    # Effective property tax (state-level). 0.3% → 95, 1.0% → 70,
    # 2.0%+ → 30.
    tax = row.get("propertyTaxRate")
    if isinstance(tax, (int, float)):
        tax_score = _clamp(110.0 - tax * 40.0)
        components.append(("Property tax burden", 0.3, tax_score))
        signals.append(_signal("Property tax", 0.3, f"{tax:.2f}%"))

    if not components:
        return 50.0, [_signal("Macro data row incomplete", 0, None)]

    total_w = sum(w for _, w, _ in components)
    score = sum(w * pts for _, w, pts in components) / total_w
    return _clamp(score), signals


# ── Composer ────────────────────────────────────────────────────────
_AXIS_LABELS: dict[str, str] = {
    "value": "Value",
    "land": "Land",
    "risk": "Risk",
    "liquidity": "Liquidity",
    "macro": "Macro",
}


def compute_investment_score(
    listing: dict[str, Any],
    *,
    county_medians: dict[str, float],
    state_medians: dict[str, float],
    county_comp_counts: dict[str, int],
    macro: dict[str, Any] | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Return {score, axes: [{key, label, score, weight, signals}, ...]}.

    Axes are returned as an ORDERED LIST (not a dict) so the frontend
    can render them in default order and so a future per-user weight
    preference can persist as a list of (key, weight) tuples without
    fighting Python dict ordering quirks.
    """
    if weights is None:
        weights = _PHASE2_WEIGHTS if macro else _PHASE1_WEIGHTS

    axis_results = [
        ("value", *score_value(listing, county_medians, state_medians)),
        ("land", *score_land(listing)),
        ("risk", *score_risk(listing)),
        ("liquidity", *score_liquidity(listing, county_comp_counts)),
        ("macro", *score_macro(listing, macro)),
    ]

    axes: list[dict[str, Any]] = []
    weighted_sum = 0.0
    weight_total = 0.0
    for key, axis_score, signals in axis_results:
        w = float(weights.get(key, 0.0))
        axes.append(
            {
                "key": key,
                "label": _AXIS_LABELS.get(key, key.title()),
                "score": round(axis_score, 1),
                "weight": round(w, 2),
                "signals": signals,
            }
        )
        if w > 0:
            weighted_sum += w * axis_score
            weight_total += w

    composite = weighted_sum / weight_total if weight_total > 0 else 50.0
    return {
        "score": round(_clamp(composite), 1),
        "axes": axes,
        "computedAt": datetime.now(timezone.utc).isoformat(),
    }


# ── Context builders (one-shot per pass) ────────────────────────────
def _normalize_county_key(state: str, county: str) -> str:
    s = (state or "").upper()
    c = (county or "").strip().lower()
    c = c.replace(" county", "").strip()
    return f"{s}|{c}" if s and c else ""


def build_county_medians(listings: list[dict[str, Any]]) -> dict[str, float]:
    """Median $/acre per county. Skips listings with no price/county."""
    bucket: dict[str, list[float]] = defaultdict(list)
    for it in listings:
        ppa = it.get("pricePerAcre") or 0.0
        if ppa <= 0:
            continue
        loc = it.get("location") or {}
        key = _normalize_county_key(loc.get("state", ""), loc.get("county", ""))
        if not key:
            continue
        bucket[key].append(float(ppa))
    return {k: statistics.median(v) for k, v in bucket.items() if len(v) >= 3}


def build_state_medians(listings: list[dict[str, Any]]) -> dict[str, float]:
    """Median $/acre per state — fallback when county comps are thin."""
    bucket: dict[str, list[float]] = defaultdict(list)
    for it in listings:
        ppa = it.get("pricePerAcre") or 0.0
        if ppa <= 0:
            continue
        loc = it.get("location") or {}
        state = (loc.get("state") or "").upper()
        if not state:
            continue
        bucket[state].append(float(ppa))
    return {k: statistics.median(v) for k, v in bucket.items() if len(v) >= 3}


def build_county_comp_counts(listings: list[dict[str, Any]]) -> dict[str, int]:
    """How many comps each county has — feeds liquidity axis."""
    counts: dict[str, int] = defaultdict(int)
    for it in listings:
        loc = it.get("location") or {}
        key = _normalize_county_key(loc.get("state", ""), loc.get("county", ""))
        if key:
            counts[key] += 1
    return dict(counts)


def load_macro_table(path: Path) -> dict[str, Any] | None:
    """Optional county-level macro table (population trend, unemployment,
    property tax). Built by `scraper/macro_data.py` from public sources."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def run(input_path: Path, output_path: Path) -> dict[str, int]:
    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    log.info(f"[invest] building context across {len(listings)} listings...")
    county_medians = build_county_medians(listings)
    state_medians = build_state_medians(listings)
    county_comp_counts = build_county_comp_counts(listings)
    macro_path = config.DATA_DIR / "macro_county.json"
    macro = load_macro_table(macro_path)
    if macro:
        log.info(f"[invest] macro table loaded: {len(macro)} county rows")
    else:
        log.info(f"[invest] macro table missing at {macro_path}; using Phase 1 weights")

    counters = {"scored": 0, "skipped": 0}
    for it in listings:
        if not isinstance(it, dict):
            counters["skipped"] += 1
            continue
        result = compute_investment_score(
            it,
            county_medians=county_medians,
            state_medians=state_medians,
            county_comp_counts=county_comp_counts,
            macro=macro,
        )
        it["investmentScore"] = result["score"]
        it["investmentBreakdown"] = result
        counters["scored"] += 1

    output_path.write_text(json.dumps(listings, indent=2))
    log.info(f"[invest] {counters}")
    return counters


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--input", type=Path, default=config.DATA_DIR / "listings.json")
    p.add_argument("--output", type=Path, default=None)
    args = p.parse_args()
    output_path = args.output or args.input
    try:
        counters = run(args.input, output_path)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(f"Done. {counters}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
