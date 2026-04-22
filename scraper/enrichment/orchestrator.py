"""Run all four geo enrichments for a single (lat, lng) point.

Each module returns None independently on failure, so a FEMA outage
doesn't block soil/elevation/watershed lookups for the listing.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .elevation import lookup_elevation
from .flood import lookup_flood_zone
from .proximity import lookup_proximity
from .soil import lookup_soil
from .watershed import lookup_watershed


def enrich_point(lat: float, lng: float) -> dict[str, Any]:
    """Look up soil, flood, elevation, watershed, and proximity data.

    All five queries run in parallel (different hosts). Missing data for
    a given source becomes `null` in the returned dict rather than an
    exception — consumers should handle partial results.

    Shape:
        {
          "lat": 47.0666,
          "lng": -112.2406,
          "soil": {...} | None,
          "flood": {...} | None,
          "elevation": {...} | None,
          "watershed": {...} | None,
          "proximity": {...} | None,
        }
    """
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            "soil": pool.submit(lookup_soil, lat, lng),
            "flood": pool.submit(lookup_flood_zone, lat, lng),
            "elevation": pool.submit(lookup_elevation, lat, lng),
            "watershed": pool.submit(lookup_watershed, lat, lng),
            "proximity": pool.submit(lookup_proximity, lat, lng),
        }
        results = {key: fut.result() for key, fut in futures.items()}

    return {"lat": lat, "lng": lng, **results}
