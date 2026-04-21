"""Generate the "Homestead Deals" curated view.

Different lens from `scraper/curate.py` (generic Top Picks):
this script applies *homestead-specific* hard filters + a composite
score tuned for what makes a parcel genuinely buildable and livable
off-grid, then hands the top candidates to Claude (Sonnet) to rank
and write buyer-facing rationale.

Output: data/homestead_deals.json — consumed by the frontend's Deals
view (see frontend/src/components/HomesteadDeals.tsx).

Usage:
    python -m scraper.deals                   # default: top 12
    python -m scraper.deals --count 20
    python -m scraper.deals --candidates 60
    python -m scraper.deals --model sonnet
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from llm import LLMCallFailed, LLMUnavailable, call_json, is_available
from logger import get_logger

log = get_logger("deals")


DEFAULT_COUNT = 12
DEFAULT_CANDIDATES = 40
DEFAULT_MODEL = "sonnet"

# Parcel / price gates
MIN_ACRES = 5.0
MAX_PRICE_USD = 500_000.0

# Water signals we'll credit (from AI tags or static features)
_WATER_TAGS = {
    "water_rights_present",
    "year_round_water",
}
_WATER_FEATURES = {
    "water_well",
    "water_creek",
    "water_pond",
}

# Red flags we treat as disqualifying regardless of score
_CRITICAL_RED_FLAGS = {
    "no_water_source",
    "no_road_access",
    "environmental_hazard",
    "title_issues_mentioned",
    "zoning_prohibits_residential",
}

# FEMA SFHA zones (inside 100-yr floodplain) we exclude
_SFHA_ZONES = {"A", "AE", "AH", "AO", "V", "VE"}


def _has_water_signal(listing: dict[str, Any]) -> bool:
    tags = set(listing.get("aiTags") or [])
    features = set(listing.get("features") or [])
    return bool(tags & _WATER_TAGS) or bool(features & _WATER_FEATURES)


def _is_in_floodplain(listing: dict[str, Any]) -> bool:
    geo = listing.get("geoEnrichment") or {}
    flood = geo.get("flood") or {}
    zone = (flood.get("floodZone") or "").upper()
    if flood.get("isSFHA") is True:
        return True
    return zone in _SFHA_ZONES


def _soil_capability(listing: dict[str, Any]) -> int | None:
    """Return SSURGO non-irrigated capability class (1=best, 8=worst) or None."""
    geo = listing.get("geoEnrichment") or {}
    soil = geo.get("soil") or {}
    raw = str(soil.get("capabilityClass") or "").strip()
    if not raw.isdigit():
        return None
    return int(raw)


def passes_hard_filters(listing: dict[str, Any]) -> tuple[bool, str | None]:
    """Return (passes, reason_if_not). Tax-sale rows and anything obviously
    disqualifying for a homestead buyer are excluded here."""
    if listing.get("status") == "tax_sale":
        return False, "tax_sale (needs separate diligence pipeline)"
    price = float(listing.get("price") or 0)
    acres = float(listing.get("acreage") or 0)
    if price <= 0 or price > MAX_PRICE_USD:
        return False, f"price {price} outside $0-${MAX_PRICE_USD:,.0f}"
    if acres < MIN_ACRES:
        return False, f"acreage {acres} < {MIN_ACRES}"
    red_flags = set(listing.get("redFlags") or [])
    bad = red_flags & _CRITICAL_RED_FLAGS
    if bad:
        return False, f"critical red flag(s): {sorted(bad)}"
    if _is_in_floodplain(listing):
        return False, "FEMA SFHA (100-yr floodplain)"
    cap = _soil_capability(listing)
    if cap is not None and cap > 6:
        return False, f"soil capability class {cap}/8 (grazing-only)"
    return True, None


def score_candidate(listing: dict[str, Any]) -> float:
    """Composite score — weighted for homestead value, not raw deal size.

    Pre-ranks before the LLM hands the top-K to Claude for qualitative
    ranking + rationale. Kept deterministic and cheap so this runs free.
    """
    deal = float(listing.get("dealScore") or 0)
    fit = float(listing.get("homesteadFitScore") or 0)
    score = 0.25 * deal + 0.45 * fit

    # Water signal is worth a lot to homesteaders
    if _has_water_signal(listing):
        score += 15
    elif "no_water_mentioned" in (listing.get("aiTags") or []):
        score -= 10

    # Prefer good soil
    cap = _soil_capability(listing)
    if cap is not None:
        if cap <= 2:
            score += 10
        elif cap <= 4:
            score += 4
        elif cap == 5:
            score += 1
        # cap 6 neutral; 7-8 filtered out by hard filter

    # Flood verification bonus (being outside SFHA is already required; being
    # explicitly zone X is a stronger positive signal than D / unstudied)
    geo = listing.get("geoEnrichment") or {}
    flood_zone = ((geo.get("flood") or {}).get("floodZone") or "").upper()
    if flood_zone == "X":
        score += 5

    # Acreage sweet spot — homestead-viable sizes
    acres = float(listing.get("acreage") or 0)
    if 10 <= acres <= 40:
        score += 5
    elif 40 < acres <= 160:
        score += 2

    # Penalize listings with multiple secondary red flags
    rf_count = len(listing.get("redFlags") or [])
    if rf_count >= 3:
        score -= 10
    elif rf_count == 2:
        score -= 4

    # Small penalty for extreme isolation (still viable, just harsher)
    tags = set(listing.get("aiTags") or [])
    if "extreme_remote" in (listing.get("redFlags") or []) or "isolated" in tags:
        score -= 3

    return round(score, 2)


def _prerank(listings: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in listings:
        ok, _ = passes_hard_filters(item)
        if not ok:
            continue
        scored.append((score_candidate(item), item))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def _compact(item: dict[str, Any]) -> dict[str, Any]:
    loc = item.get("location") or {}
    geo = item.get("geoEnrichment") or {}
    soil = geo.get("soil") or {}
    flood = geo.get("flood") or {}
    elev = geo.get("elevation") or {}
    watershed = geo.get("watershed") or {}
    return {
        "id": item.get("id"),
        "title": (item.get("title") or "")[:120],
        "price": item.get("price"),
        "acreage": item.get("acreage"),
        "pricePerAcre": item.get("pricePerAcre"),
        "state": loc.get("state", ""),
        "county": loc.get("county", ""),
        "dealScore": item.get("dealScore"),
        "homesteadFitScore": item.get("homesteadFitScore"),
        "aiTags": item.get("aiTags") or [],
        "redFlags": item.get("redFlags") or [],
        "aiSummary": (item.get("aiSummary") or "")[:500],
        "soil": {
            "class": soil.get("capabilityClass"),
            "name": soil.get("mapUnitName"),
            "slopePct": soil.get("slopePercent"),
        }
        if soil
        else None,
        "floodZone": flood.get("floodZone") or None,
        "elevationFeet": elev.get("elevationFeet"),
        "watershed": watershed.get("watershedName"),
    }


def _build_prompt(candidates: list[dict[str, Any]], pick_count: int) -> str:
    payload = json.dumps([_compact(c) for c in candidates], indent=2)
    return f"""You are a scout picking the {pick_count} best land listings for someone looking
to BUY AND HOMESTEAD — self-sufficient rural living, possibly off-grid,
within a sane budget.

These candidates have already passed hard filters (price ≤ $500k, ≥5 acres,
not in a FEMA floodplain, no critical red flags, soil capability class ≤6).
Your job is to pick the {pick_count} that are genuinely the best homesteading
BUYS — where the combination of price, land quality, water, buildability,
and remoteness-vs-services adds up to a clear case.

Return ONLY a JSON object (no prose, no markdown):

{{
  "picks": [
    {{
      "id": "<listing id exactly as given>",
      "rank": 1,
      "headline": "<5-9 word concrete label, no emoji or hype>",
      "reason": "<3-4 sentences. Reference concrete numbers (acres, price/acre, soil class, flood zone, watershed). Say specifically what makes this buyable for homesteading AND what the main risk or trade-off is. No marketing language.>"
    }},
    ...
  ]
}}

Rules:
- Exactly {pick_count} picks, ranked 1..{pick_count} (1 = best).
- Each id MUST match one of the candidate ids below.
- Favor listings with year-round water AND buildable soil over cheap-but-problematic.
- Flag if the caveat is real (e.g. remote, no well yet, short growing season).
- Do NOT pad — if you only see strong cases for fewer than {pick_count}, still
  return {pick_count} and put your weaker reasoning in the reason for the tail.

CANDIDATES (JSON):
{payload}
"""


def _sanitize(raw: Any, valid_ids: set[str], expected: int) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        raise LLMCallFailed("deals response was not a JSON object")
    picks = raw.get("picks")
    if not isinstance(picks, list):
        raise LLMCallFailed("deals response missing 'picks' array")
    seen: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for p in picks:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or pid not in valid_ids or pid in seen:
            continue
        seen.add(pid)
        cleaned.append(
            {
                "id": pid,
                "headline": str(p.get("headline", ""))[:120],
                "reason": str(p.get("reason", ""))[:1000],
            }
        )
    for i, pick in enumerate(cleaned[:expected], start=1):
        pick["rank"] = i
    return cleaned[:expected]


def generate_deals(
    input_path: Path,
    output_path: Path,
    *,
    pick_count: int = DEFAULT_COUNT,
    candidate_count: int = DEFAULT_CANDIDATES,
    model: str = DEFAULT_MODEL,
    use_cache: bool = True,
) -> dict[str, Any]:
    if not is_available():
        raise LLMUnavailable(
            "`claude` CLI not available — install Claude Code and run `claude login`"
        )
    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    # Count how many pass the hard filters for reporting (separate from
    # the pre-rank limit so the user can see the funnel).
    pre = [item for item in listings if passes_hard_filters(item)[0]]
    candidates = _prerank(pre, candidate_count)

    if len(candidates) < pick_count:
        log.info(
            f"[deals] only {len(candidates)} listings pass hard filters; "
            f"shrinking pick count from {pick_count} to match"
        )
        pick_count = len(candidates)
    if pick_count == 0:
        raise ValueError(
            "no listings pass the homestead-deal filters — loosen filters or "
            "wait for more scrape data"
        )

    prompt = _build_prompt(candidates, pick_count)
    log.info(
        f"[deals] {len(listings)} listings → {len(pre)} pass filters → "
        f"{len(candidates)} candidates → asking {model} for top {pick_count}"
    )
    raw = call_json(prompt, model=model, use_cache=use_cache, tag="deals")
    valid_ids = {c["id"] for c in candidates}
    picks = _sanitize(raw, valid_ids, pick_count)

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "totalListings": len(listings),
        "passedFiltersCount": len(pre),
        "candidateCount": len(candidates),
        "pickCount": len(picks),
        "filterSummary": {
            "minAcres": MIN_ACRES,
            "maxPriceUsd": MAX_PRICE_USD,
            "criticalRedFlagsExcluded": sorted(_CRITICAL_RED_FLAGS),
            "sfhaZonesExcluded": sorted(_SFHA_ZONES),
            "maxSoilCapabilityClass": 6,
        },
        "picks": picks,
    }
    output_path.write_text(json.dumps(result, indent=2))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--input",
        type=Path,
        default=config.DATA_DIR / "listings.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=config.DATA_DIR / "homestead_deals.json",
    )
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT)
    parser.add_argument("--candidates", type=int, default=DEFAULT_CANDIDATES)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()

    try:
        result = generate_deals(
            args.input,
            args.output,
            pick_count=args.count,
            candidate_count=args.candidates,
            model=args.model,
            use_cache=not args.no_cache,
        )
    except (LLMUnavailable, ValueError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except LLMCallFailed as e:
        print(f"error: deals call failed: {e}", file=sys.stderr)
        return 2

    print(
        f"Done. {result['pickCount']} picks from {result['candidateCount']} "
        f"candidates ({result['passedFiltersCount']} passed filters out of "
        f"{result['totalListings']} total)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
