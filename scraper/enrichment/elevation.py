"""USGS Elevation Point Query Service (EPQS) lookup.

Given lat/lng, returns the 3DEP-derived elevation in meters. Single-point
endpoint, no auth, no key.

Docs: https://apps.nationalmap.gov/epqs/
"""

from __future__ import annotations

from typing import Any

from .http_client import HttpError, get_json

_EPQS_URL = "https://epqs.nationalmap.gov/v1/json"


def lookup_elevation(lat: float, lng: float) -> dict[str, Any] | None:
    """Return elevation info for this point, or None on failure.

    Shape:
        {
          "elevationMeters": 1430.94,
          "elevationFeet": 4694.0,
        }
    """
    try:
        response = get_json(_EPQS_URL, params={"x": lng, "y": lat, "units": "Meters"})
    except HttpError:
        return None

    # Endpoint returns {"value": <meters>} or similar; defensive against shape changes
    raw = response.get("value")
    try:
        meters = float(raw)
    except (TypeError, ValueError):
        return None
    if meters <= -10000:  # sentinel for no data
        return None

    return {
        "elevationMeters": round(meters, 1),
        "elevationFeet": round(meters * 3.28084, 1),
    }
