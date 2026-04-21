"""USDA Soil Data Access (SDA) lookup.

Given lat/lng, returns the dominant soil map unit and attributes from
SSURGO via the `muaggatt` (map-unit aggregated attribute) table.

We expose the signals that actually matter for homesteading:

- Non-irrigated land capability class (niccdcd) — 1-8 scale where 1-4 is
  arable, 5-6 is marginal, 7-8 is grazing/forest only. Much more useful
  for a rural-viability lens than raw soil names.
- Dominant slope percent
- Drainage class
- Flood frequency
- Depth to bedrock and seasonal water table (matter for building + septic)

Two queries are needed: the muname lookup joins to mapunit, and
aggregated attributes come from muaggatt. Combined in one SQL for one
round-trip.

Docs: https://sdmdataaccess.sc.egov.usda.gov/
"""

from __future__ import annotations

from typing import Any

from .http_client import HttpError, post_json

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/SDMTabularService/post.rest"

# Two CTEs are not supported here; we do the join in WHERE. Note that
# `SDA_Get_Mukey_from_intersection_with_WktWgs84` returns a table with
# a single column (mukey), so the IN subquery needs `SELECT *`.
_SDA_QUERY = """
SELECT TOP 1
  mu.mukey,
  mu.muname,
  mu.farmlndcl,
  muag.slopegradwta,
  muag.drclassdcd,
  muag.niccdcd,
  muag.niccdcdpct,
  muag.flodfreqdcd,
  muag.hydgrpdcd,
  muag.brockdepmin,
  muag.wtdepannmin
FROM mapunit mu
LEFT JOIN muaggatt muag ON muag.mukey = mu.mukey
WHERE mu.mukey IN (
  SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point ({lng} {lat})')
)
"""


# Lookup table for interpreting niccdcd (0-8). Scale is from the USDA
# Land Capability Classification guide.
_CAPABILITY_CLASS_DESCRIPTIONS: dict[str, str] = {
    "1": "Prime cropland, few limitations",
    "2": "Good cropland, some limitations",
    "3": "Moderate cropland, careful management needed",
    "4": "Marginal cropland, severe limitations",
    "5": "Forage / pasture, unsuited to cultivation",
    "6": "Grazing / forestry, severe limitations",
    "7": "Grazing / forestry, very severe limitations",
    "8": "Unsuited to agriculture (recreation, wildlife)",
}


def _float_or_none(v: Any) -> float | None:
    try:
        f = float(v)
        return f
    except (TypeError, ValueError):
        return None


def lookup_soil(lat: float, lng: float) -> dict[str, Any] | None:
    """Return a dict describing the dominant soil at this point, or None
    if outside SSURGO coverage or on API failure.

    Shape:
        {
          "mapUnitKey": "147920",
          "mapUnitName": "Mocmont-Tolex complex, cool, 25 to 60 percent slopes",
          "farmlandClass": "Not prime farmland",
          "capabilityClass": "7",              # niccdcd; 1-8 where 1 is best
          "capabilityClassDescription": "Grazing / forestry, very severe limitations",
          "capabilityClassPercent": 97,
          "slopePercent": 42.7,
          "drainageClass": "Well drained",
          "floodFrequency": "None",
          "hydrologicGroup": "A",
          "bedrockDepthInches": 46,
          "waterTableDepthInches": None,
        }
    """
    query = _SDA_QUERY.format(lng=lng, lat=lat).strip()
    try:
        response = post_json(SDA_URL, {"query": query, "format": "JSON+COLUMNNAME"})
    except HttpError:
        return None

    rows = response.get("Table") or []
    if len(rows) < 2:
        return None

    columns = rows[0]
    data = rows[1]
    raw = dict(zip(columns, data))

    cap = str(raw.get("niccdcd") or "").strip()
    cap_desc = _CAPABILITY_CLASS_DESCRIPTIONS.get(cap, "")

    return {
        "mapUnitKey": str(raw.get("mukey") or ""),
        "mapUnitName": raw.get("muname") or "",
        "farmlandClass": raw.get("farmlndcl") or "",
        "capabilityClass": cap,
        "capabilityClassDescription": cap_desc,
        "capabilityClassPercent": _float_or_none(raw.get("niccdcdpct")),
        "slopePercent": _float_or_none(raw.get("slopegradwta")),
        "drainageClass": raw.get("drclassdcd") or "",
        "floodFrequency": raw.get("flodfreqdcd") or "",
        "hydrologicGroup": raw.get("hydgrpdcd") or "",
        "bedrockDepthInches": _float_or_none(raw.get("brockdepmin")),
        "waterTableDepthInches": _float_or_none(raw.get("wtdepannmin")),
    }
