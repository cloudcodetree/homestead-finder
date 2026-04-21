"""FEMA National Flood Hazard Layer (NFHL) lookup.

Given lat/lng, returns the FEMA flood zone designation (A, AE, X, VE, etc.)
for that point. A/AE/VE zones indicate 100-year floodplain — a genuine
red flag for homesteading and insurance costs.

Service is known to flake with 504s; the http_client's retry loop handles it.

Docs: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer
"""

from __future__ import annotations

from typing import Any

from .http_client import HttpError, get_json

# Layer 28 is "Flood Hazard Zones" in the NFHL public map service.
_NFHL_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
)


def lookup_flood_zone(lat: float, lng: float) -> dict[str, Any] | None:
    """Return a dict describing the FEMA flood zone at this point, or None
    if the point has no mapped flood-zone coverage.

    Shape:
        {
          "floodZone": "AE" | "X" | "VE" | "A" | "D" | "AH" | ...,
          "isSFHA": True,   # 100-yr floodplain flag (Special Flood Hazard Area)
          "baseFloodElevation": 1234.0 | None,
        }

    FEMA zone key:
      - A, AE, AH, AO, V, VE  → 100-year floodplain (SFHA)
      - X                     → outside floodplain (0.2% or minimal)
      - D                     → unstudied
    """
    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "outFields": "FLD_ZONE,SFHA_TF,STATIC_BFE",
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        response = get_json(_NFHL_URL, params=params)
    except HttpError:
        return None

    features = response.get("features") or []
    if not features:
        return None

    attrs = features[0].get("attributes") or {}
    zone = attrs.get("FLD_ZONE") or ""
    sfha_raw = attrs.get("SFHA_TF")
    bfe = attrs.get("STATIC_BFE")

    def _float_or_none(v: Any) -> float | None:
        try:
            f = float(v)
            # FEMA uses -9999 as a sentinel for "not applicable"
            return f if f > -1000 else None
        except (TypeError, ValueError):
            return None

    return {
        "floodZone": str(zone),
        "isSFHA": sfha_raw == "T" or zone in {"A", "AE", "AH", "AO", "V", "VE"},
        "baseFloodElevation": _float_or_none(bfe),
    }
