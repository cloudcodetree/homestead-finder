"""Self-Sufficiency Score — Python port of frontend/src/utils/selfSufficiency.ts.

Pre-computes the headline autonomy metric at scrape time and stamps
`selfSufficiency: { composite, axes }` onto each listing in the slim
index. Lets the Browse page render axis bars + filter on per-axis
minimums without shipping `geoEnrichment` through the index — the
biggest single contributor to listings.json's bulk.

The TS version (used on the detail page) recomputes the full report
including per-axis gap interventions and prose verdicts. Those are
detail-only and stay client-side since the detail page fetches the
full per-id record. The Python port emits just the numerical core:

    {
        "composite": 67,
        "axes": [
            {"key": "food", "score": 22, "weight": 0.28},
            {"key": "water", "score": 98, "weight": 0.25},
            ...
        ]
    }

Keep the constants / band thresholds in sync with the TS version. If
you tweak one, tweak the other — they're calibrated together.
"""

from __future__ import annotations

from typing import Any

AXIS_WEIGHTS = {
    "food": 0.28,
    "water": 0.25,
    "energy": 0.20,
    "shelter": 0.15,
    "resilience": 0.12,
}

CAP_SCORES = {1: 100, 2: 88, 3: 75, 4: 60, 5: 45, 6: 35, 7: 22, 8: 10}


def _clip(v: float) -> int:
    return max(0, min(100, round(v)))


def _features(p: dict[str, Any]) -> set[str]:
    return set(p.get("features") or [])


def _improvements(p: dict[str, Any]) -> dict[str, Any]:
    return p.get("improvements") or {}


def _food(p: dict[str, Any]) -> int:
    soil = (p.get("geoEnrichment") or {}).get("soil") or {}
    flood = (p.get("geoEnrichment") or {}).get("flood") or {}
    acres = float(p.get("acreage") or 0)
    features = _features(p)

    try:
        cap = int(soil.get("capabilityClass") or 0) or 5
    except (TypeError, ValueError):
        cap = 5
    cap_score = CAP_SCORES.get(cap, 45)

    # Acreage gate — same shape as TS: min(1, max(0.3, acres/5))
    acre_factor = min(1.0, max(0.3, acres / 5.0))
    score = cap_score * acre_factor

    drain = (soil.get("drainageClass") or "").lower()
    if "poorly" in drain:
        score -= 10
    if flood.get("isSFHA"):
        score -= 12
    if "pasture" in features:
        score += 6
    if "timber" in features:
        score += 4
    return _clip(score)


def _water(p: dict[str, Any]) -> int:
    features = _features(p)
    improvements = _improvements(p)
    proximity = (p.get("geoEnrichment") or {}).get("proximity") or {}
    flood = (p.get("geoEnrichment") or {}).get("flood") or {}
    location = p.get("location") or {}
    lat = float(location.get("lat") or 0)
    lng_abs = abs(float(location.get("lng") or 0))

    score = 30
    has_well = "water_well" in features or improvements.get("well")
    has_city = improvements.get("water_city")
    if has_well or has_city:
        score += 35

    named_water = [str(n).lower() for n in (proximity.get("namedWaterFeatures") or [])]
    has_flowing = "water_creek" in features or any(
        any(k in n for k in ("creek", "stream", "run", "river")) for n in named_water
    )
    if has_flowing:
        score += 18
    if "water_pond" in features:
        score += 10

    # Desert SW penalty: lat 30-38, lng 103-114 (interior arid US)
    desert_sw = 30 < lat < 38 and 103 < lng_abs < 114
    if not desert_sw:
        score += 5

    if flood.get("isSFHA"):
        score -= 8
    return _clip(score)


def _energy(p: dict[str, Any]) -> int:
    location = p.get("location") or {}
    lat = abs(float(location.get("lat") or 0))
    acres = float(p.get("acreage") or 0)
    features = _features(p)
    improvements = _improvements(p)
    soil = (p.get("geoEnrichment") or {}).get("soil") or {}

    # Solar baseline by latitude (matches the TS piecewise table)
    if lat < 32:
        sun_hours = 6.0
    elif lat < 36:
        sun_hours = 5.5
    elif lat < 40:
        sun_hours = 5.0
    elif lat < 44:
        sun_hours = 4.5
    else:
        sun_hours = 4.2
    score = (sun_hours / 6.0) * 60.0

    if "timber" in features or (acres >= 10 and "hunting" in features):
        score += 12
    if acres >= 1.5:
        score += 6
    try:
        slope = float(soil.get("slopePercent") or 0)
    except (TypeError, ValueError):
        slope = 0.0
    if "water_creek" in features and slope >= 5:
        score += 10
    if improvements.get("electric") or "electric" in features:
        score += 8
    return _clip(score)


def _shelter(p: dict[str, Any]) -> int:
    features = _features(p)
    improvements = _improvements(p)
    acres = float(p.get("acreage") or 0)

    score = 20
    if improvements.get("home") or improvements.get("cabin"):
        score += 50
    elif improvements.get("outbuilding") or improvements.get("barn"):
        score += 20
    if "structures" in features:
        score += 10
    if "timber" in features and acres >= 5:
        score += 15
    if improvements.get("well") or "water_well" in features:
        score += 8
    if improvements.get("septic") or "septic" in features:
        score += 8
    if improvements.get("electric") or "electric" in features:
        score += 6
    if p.get("moveInReady"):
        score = max(score, 90)
    return _clip(score)


def _resilience(p: dict[str, Any]) -> int:
    features = _features(p)
    flood = (p.get("geoEnrichment") or {}).get("flood") or {}
    soil = (p.get("geoEnrichment") or {}).get("soil") or {}
    location = p.get("location") or {}
    lat = float(location.get("lat") or 0)
    lng_abs = abs(float(location.get("lng") or 0))
    acres = float(p.get("acreage") or 0)

    score = 75
    if flood.get("isSFHA"):
        score -= 30
    zone = flood.get("floodZone")
    if zone in ("X", "X500"):
        score += 5

    # Arid SW interior — drought proxy (lat 30-38, lng 103-116)
    if 30 < lat < 38 and 103 < lng_abs < 116:
        score -= 12

    try:
        slope = float(soil.get("slopePercent") or 0)
    except (TypeError, ValueError):
        slope = 0.0
    if slope > 20:
        score -= 10
    elif slope > 12:
        score -= 5

    if acres >= 10:
        score += 8
    if "no_hoa" in features:
        score += 5
    return _clip(score)


def compute_self_sufficiency(p: dict[str, Any]) -> dict[str, Any]:
    """Return the slim {composite, axes} payload for a listing dict.

    `axes` is a list of {key, score, weight} entries in the canonical
    order Food → Water → Energy → Shelter → Resilience. Composite is
    the weighted average, rounded to int.
    """
    food = _food(p)
    water = _water(p)
    energy = _energy(p)
    shelter = _shelter(p)
    resilience = _resilience(p)
    composite = round(
        food * AXIS_WEIGHTS["food"]
        + water * AXIS_WEIGHTS["water"]
        + energy * AXIS_WEIGHTS["energy"]
        + shelter * AXIS_WEIGHTS["shelter"]
        + resilience * AXIS_WEIGHTS["resilience"]
    )
    return {
        "composite": composite,
        "axes": [
            {"key": "food", "score": food, "weight": AXIS_WEIGHTS["food"]},
            {"key": "water", "score": water, "weight": AXIS_WEIGHTS["water"]},
            {"key": "energy", "score": energy, "weight": AXIS_WEIGHTS["energy"]},
            {"key": "shelter", "score": shelter, "weight": AXIS_WEIGHTS["shelter"]},
            {
                "key": "resilience",
                "score": resilience,
                "weight": AXIS_WEIGHTS["resilience"],
            },
        ],
    }
