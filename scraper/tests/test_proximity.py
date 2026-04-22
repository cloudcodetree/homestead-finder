"""Tests for scraper/enrichment/proximity.py.

Overpass HTTP is mocked out — tests never hit the real endpoint.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from enrichment import proximity


# Sample Overpass response for the "nearest town" query, mixed bag of
# populated and unpopulated places.
_TOWN_RESPONSE = {
    "elements": [
        {
            # Closer but no population tag — ignored by min_population
            "type": "node",
            "lat": 47.05,
            "lon": -112.24,
            "tags": {"place": "hamlet", "name": "Nowhere"},
        },
        {
            # 29mi away, pop 789 — the expected winner
            "type": "node",
            "lat": 47.25,
            "lon": -111.68,
            "tags": {"place": "village", "name": "Cascade", "population": "789"},
        },
        {
            # Further but larger
            "type": "node",
            "lat": 46.59,
            "lon": -112.04,
            "tags": {"place": "city", "name": "Helena", "population": "34729"},
        },
    ]
}


_EMPTY_RESPONSE: dict = {"elements": []}


def test_lookup_nearest_town_picks_nearest_populated_place():
    with patch.object(proximity, "_post_overpass", return_value=_TOWN_RESPONSE):
        out = proximity.lookup_nearest_town(47.0666, -112.24)
    assert out is not None
    assert out["nearestTownName"] == "Cascade"
    assert out["nearestTownPopulation"] == 789
    assert out["nearestTownKind"] == "village"
    # The Haversine for (47.066, -112.24) → (47.25, -111.68) is ~28 mi
    assert 25 <= out["nearestTownDistanceMiles"] <= 33


def test_lookup_nearest_town_respects_min_population():
    response = {
        "elements": [
            {
                "type": "node",
                "lat": 47.1,
                "lon": -112.25,
                "tags": {"place": "village", "name": "Tiny", "population": "50"},
            },
            {
                "type": "node",
                "lat": 47.25,
                "lon": -111.68,
                "tags": {"place": "city", "name": "BigEnough", "population": "5000"},
            },
        ]
    }
    with patch.object(proximity, "_post_overpass", return_value=response):
        out = proximity.lookup_nearest_town(47.0666, -112.24, min_population=500)
    assert out is not None
    # Tiny (pop 50) is filtered out even though it's closer
    assert out["nearestTownName"] == "BigEnough"


def test_lookup_nearest_town_returns_none_when_no_match():
    with patch.object(proximity, "_post_overpass", return_value=_EMPTY_RESPONSE):
        assert proximity.lookup_nearest_town(47.0666, -112.24) is None


def test_lookup_nearest_town_returns_none_on_http_failure():
    with patch.object(proximity, "_post_overpass", return_value=None):
        assert proximity.lookup_nearest_town(47.0666, -112.24) is None


def test_lookup_nearest_town_handles_population_with_commas():
    response = {
        "elements": [
            {
                "type": "node",
                "lat": 47.25,
                "lon": -111.68,
                # OSM sometimes stores population with thousands separators
                "tags": {"place": "city", "name": "X", "population": "12,345"},
            }
        ]
    }
    with patch.object(proximity, "_post_overpass", return_value=response):
        out = proximity.lookup_nearest_town(47.0666, -112.24)
    assert out is not None
    assert out["nearestTownPopulation"] == 12345


def test_lookup_water_features_counts_and_samples_names():
    response = {
        "elements": [
            {
                "type": "way",
                "tags": {"waterway": "stream", "name": "Little Wolf Creek"},
            },
            {"type": "way", "tags": {"waterway": "stream"}},  # unnamed
            {"type": "way", "tags": {"natural": "water", "name": "Wolf Pond"}},
            {"type": "relation", "tags": {"natural": "water"}},
        ]
    }
    with patch.object(proximity, "_post_overpass", return_value=response):
        out = proximity.lookup_water_features(47.0, -112.0)
    assert out is not None
    assert out["waterFeatureCount"] == 4
    assert "Little Wolf Creek" in out["namedWaterFeatures"]
    assert "Wolf Pond" in out["namedWaterFeatures"]
    assert out["searchRadiusMiles"] == 5.0  # default 8047m → 5mi


def test_lookup_water_features_dedupes_names():
    response = {
        "elements": [
            {"type": "way", "tags": {"waterway": "stream", "name": "Creek A"}},
            # Two features with the same name — only kept once in the sample
            {"type": "way", "tags": {"waterway": "stream", "name": "Creek A"}},
        ]
    }
    with patch.object(proximity, "_post_overpass", return_value=response):
        out = proximity.lookup_water_features(47.0, -112.0)
    assert out["waterFeatureCount"] == 2
    assert out["namedWaterFeatures"] == ["Creek A"]


def test_lookup_water_features_returns_zero_count_when_empty():
    with patch.object(proximity, "_post_overpass", return_value=_EMPTY_RESPONSE):
        out = proximity.lookup_water_features(47.0, -112.0)
    assert out == {
        "waterFeatureCount": 0,
        "namedWaterFeatures": [],
        "searchRadiusMiles": 5.0,
    }


def test_lookup_water_features_returns_none_on_http_failure():
    with patch.object(proximity, "_post_overpass", return_value=None):
        assert proximity.lookup_water_features(47.0, -112.0) is None


def test_lookup_proximity_merges_both_results():
    with patch.object(
        proximity,
        "_post_overpass",
        side_effect=[
            _TOWN_RESPONSE,
            {"elements": [{"type": "way", "tags": {"waterway": "stream"}}]},
        ],
    ):
        out = proximity.lookup_proximity(47.0666, -112.24)
    assert out is not None
    assert out["nearestTownName"] == "Cascade"
    assert out["waterFeatureCount"] == 1


def test_lookup_proximity_returns_none_only_when_both_fail():
    with patch.object(proximity, "_post_overpass", return_value=None):
        assert proximity.lookup_proximity(47.0666, -112.24) is None


def test_lookup_proximity_survives_partial_failure():
    # Town fetch fails but water fetch succeeds
    with patch.object(
        proximity,
        "_post_overpass",
        side_effect=[
            None,
            {"elements": [{"type": "way", "tags": {"waterway": "stream"}}]},
        ],
    ):
        out = proximity.lookup_proximity(47.0666, -112.24)
    assert out is not None
    assert "nearestTownName" not in out  # town missing
    assert out["waterFeatureCount"] == 1


def test_haversine_miles_agrees_with_known_distance():
    # San Francisco → Los Angeles ≈ 347 mi (great-circle)
    sf = (37.7749, -122.4194)
    la = (34.0522, -118.2437)
    d = proximity._haversine_miles(sf[0], sf[1], la[0], la[1])
    assert 340 < d < 360
