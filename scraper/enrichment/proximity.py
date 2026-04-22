"""Proximity enrichment via OpenStreetMap / Overpass.

Given a (lat, lng), returns two "how-remote-is-this-really" signals:

- **Nearest sizable populated place** (any OSM place tagged as city/town/
  village with a non-zero `population` tag) — answers "how far to town".
- **Water features within 5 miles** — counts and names streams, rivers,
  lakes, and ponds tagged in OSM nearby. Sparse in rural areas, which is
  expected and documented.

Uses the public Overpass endpoint. Free, no key required, but rate
limited (~2 qps sustainable). The http_client retries handle 429s and
occasional timeouts. See ADR-013 (geospatial enrichment) for the
broader context; this file sits alongside soil.py / flood.py /
elevation.py / watershed.py as the fifth gov-ish enrichment source.
"""

from __future__ import annotations

import math
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from logger import get_logger

from .http_client import DEFAULT_TIMEOUT, USER_AGENT

log = get_logger("enrichment.proximity")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Defaults tuned for rural-US scale — a 50mi / 80km radius is wide enough
# to catch a meaningful "town" even in the emptiest parts of MT/WY/NM.
DEFAULT_TOWN_SEARCH_RADIUS_METERS = 80_000
DEFAULT_WATER_SEARCH_RADIUS_METERS = 8_047  # 5 miles

# OSM place= values we count as a "town" (excludes hamlet which often has
# no permanent residents, and locality which is historical).
_PLACE_KINDS = "city|town|village"


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in miles."""
    r_miles = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    )
    return 2 * r_miles * math.asin(math.sqrt(a))


def _post_overpass(query: str, timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any] | None:
    """POST a single Overpass QL query. Returns None on any failure —
    Overpass occasionally 429s or 504s; callers should treat missing
    data as 'unknown', not 'zero'."""
    body = urlencode({"data": query}).encode()
    req = Request(
        OVERPASS_URL,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            import json

            return json.load(resp)
    except Exception as e:
        log.info(f"[proximity] Overpass call failed: {type(e).__name__}: {e}")
        return None


def _has_population_tag_filter() -> str:
    """Overpass filter snippet that requires the place to have a numeric
    population tag at all. We do the minimum-population comparison in
    Python (Overpass regex can't compare numerics safely across both
    string and integer representations of population tags)."""
    return '["population"~"^[0-9]+$"]'


def lookup_nearest_town(
    lat: float,
    lng: float,
    *,
    radius_meters: int = DEFAULT_TOWN_SEARCH_RADIUS_METERS,
    min_population: int = 500,
) -> dict[str, Any] | None:
    """Return info on the nearest populated place to this point, or None
    on failure / no match in range.

    Shape:
        {
          "nearestTownName": "Cascade",
          "nearestTownDistanceMiles": 29.0,
          "nearestTownPopulation": 789,
          "nearestTownKind": "village",  # city|town|village
          "searchRadiusMiles": 50.0,
        }
    """
    query = (
        f"[out:json][timeout:20];"
        f"("
        f'node(around:{radius_meters},{lat},{lng})[place~"{_PLACE_KINDS}"]{_has_population_tag_filter()};'
        f");out body;"
    )
    data = _post_overpass(query)
    if data is None:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for element in data.get("elements", []) or []:
        tags = element.get("tags") or {}
        try:
            pop = int(tags.get("population", "0").replace(",", "") or 0)
        except (ValueError, AttributeError):
            pop = 0
        if pop < min_population:
            continue
        try:
            dist = _haversine_miles(lat, lng, element["lat"], element["lon"])
        except (KeyError, TypeError):
            continue
        if best is None or dist < best[0]:
            best = (dist, {"tags": tags, "population": pop})

    if best is None:
        return None
    dist, info = best
    tags = info["tags"]
    return {
        "nearestTownName": tags.get("name", ""),
        "nearestTownDistanceMiles": round(dist, 1),
        "nearestTownPopulation": info["population"],
        "nearestTownKind": tags.get("place", ""),
        "searchRadiusMiles": round(radius_meters / 1609.34, 1),
    }


def lookup_water_features(
    lat: float,
    lng: float,
    *,
    radius_meters: int = DEFAULT_WATER_SEARCH_RADIUS_METERS,
) -> dict[str, Any] | None:
    """Count + sample named water features within the radius.

    Shape:
        {
          "waterFeatureCount": 3,
          "namedWaterFeatures": ["Little Wolf Creek", "Wolf Creek Pond", ...],
          "searchRadiusMiles": 5.0,
        }

    OSM coverage is sparse in rural US; a count of 0 doesn't mean no
    water exists — just that nothing is tagged in OSM near this point.
    The SSURGO soil drainage class and USGS watershed name already
    populated on geoEnrichment are more reliable signals for
    homestead-viability water access than this OSM-derived one.
    """
    query = (
        f"[out:json][timeout:20];"
        f"("
        f'way(around:{radius_meters},{lat},{lng})[waterway~"stream|river|canal"];'
        f"way(around:{radius_meters},{lat},{lng})[natural=water];"
        f"relation(around:{radius_meters},{lat},{lng})[natural=water];"
        f");out center tags;"
    )
    data = _post_overpass(query)
    if data is None:
        return None
    named: list[str] = []
    count = 0
    for element in data.get("elements", []) or []:
        count += 1
        name = (element.get("tags") or {}).get("name")
        if name and name not in named:
            named.append(name)
    # Cap the sample so the serialized JSON stays compact
    return {
        "waterFeatureCount": count,
        "namedWaterFeatures": named[:10],
        "searchRadiusMiles": round(radius_meters / 1609.34, 1),
    }


def lookup_proximity(lat: float, lng: float) -> dict[str, Any] | None:
    """Combine town + water lookups into a single proximity dict.

    Overpass fair-use is ~2 qps sustained — and when several listings are
    enriched in parallel, the aggregated burst trips rate limits fast.
    We serialize the two queries within one call AND sleep ~1.2s between
    them so a pool of 4 workers still stays under ~3 qps against the
    public endpoint. Callers expecting a lot of data should use
    `--concurrency 2` on enrich_geo as well.

    Returns None only if BOTH calls fail; otherwise returns what's
    available (either key set may be missing).
    """
    town = lookup_nearest_town(lat, lng)
    # Spread the pair — empirically cuts 429s on the public endpoint
    time.sleep(1.2)
    water = lookup_water_features(lat, lng)
    if town is None and water is None:
        return None
    merged: dict[str, Any] = {}
    if town is not None:
        merged.update(town)
    if water is not None:
        merged.update(water)
    return merged


# Overpass asks for manners; keep queries sequential enough to stay well
# under their fair-use ceiling. Callers batching across many listings
# should throttle with `time.sleep(0.5)` between calls.
__all__ = [
    "lookup_nearest_town",
    "lookup_water_features",
    "lookup_proximity",
    "DEFAULT_TOWN_SEARCH_RADIUS_METERS",
    "DEFAULT_WATER_SEARCH_RADIUS_METERS",
]
