"""USGS Watershed Boundary Dataset (WBD) lookup.

Given lat/lng, returns the HUC-12 subwatershed containing the point.
HUC (Hydrologic Unit Code) is the standard hierarchy for US watersheds;
HUC-12 is ~15-40k-acre subwatersheds that are useful for understanding
a property's water context (what creek/river system it drains into).

Layer 6 on the WBD MapServer = 12-digit HUs.

Docs: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer
"""

from __future__ import annotations

from typing import Any

from .http_client import HttpError, get_json

_WBD_HUC12_URL = (
    "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query"
)


def lookup_watershed(lat: float, lng: float) -> dict[str, Any] | None:
    """Return HUC-12 watershed info, or None on failure.

    Shape:
        {
          "huc12": "100301011905",
          "watershedName": "Wolf Creek",
          "areaAcres": 24519.83,
          "states": "MT",
        }
    """
    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        # WBD field names are lowercase — case matters here.
        "outFields": "huc12,name,areaacres,states",
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        response = get_json(_WBD_HUC12_URL, params=params)
    except HttpError:
        return None

    features = response.get("features") or []
    if not features:
        return None

    attrs = features[0].get("attributes") or {}
    huc = attrs.get("huc12") or ""
    name = attrs.get("name") or ""
    if not huc:
        return None

    def _float_or_none(v: Any) -> float | None:
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    return {
        "huc12": str(huc),
        "watershedName": str(name),
        "areaAcres": _float_or_none(attrs.get("areaacres")),
        "states": str(attrs.get("states") or ""),
    }
