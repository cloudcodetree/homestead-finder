"""Tests for the four government-API enrichment modules + orchestrator.

HTTP is mocked so no real requests go to USDA/FEMA/USGS.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from enrichment import elevation, flood, orchestrator, soil, watershed
from enrichment.http_client import HttpError


# ── soil.py ─────────────────────────────────────────────────────────────────


def test_soil_returns_structured_dict_on_happy_path():
    fake_table = {
        "Table": [
            [
                "mukey",
                "muname",
                "farmlndcl",
                "slopegradwta",
                "drclassdcd",
                "niccdcd",
                "niccdcdpct",
                "flodfreqdcd",
                "hydgrpdcd",
                "brockdepmin",
                "wtdepannmin",
            ],
            [
                "147920",
                "Mocmont-Tolex complex",
                "Not prime farmland",
                "42.7",
                "Well drained",
                "7",
                "97",
                "None",
                "A",
                "46",
                None,
            ],
        ]
    }
    with patch.object(soil, "post_json", return_value=fake_table):
        out = soil.lookup_soil(47.0, -112.0)
    assert out is not None
    assert out["mapUnitKey"] == "147920"
    assert out["capabilityClass"] == "7"
    assert "very severe" in out["capabilityClassDescription"].lower()
    assert out["slopePercent"] == 42.7
    assert out["hydrologicGroup"] == "A"
    assert out["bedrockDepthInches"] == 46.0
    assert out["waterTableDepthInches"] is None


def test_soil_returns_none_when_no_rows():
    with patch.object(soil, "post_json", return_value={"Table": []}):
        assert soil.lookup_soil(47.0, -112.0) is None


def test_soil_returns_none_when_only_header_row():
    with patch.object(soil, "post_json", return_value={"Table": [["mukey"]]}):
        assert soil.lookup_soil(47.0, -112.0) is None


def test_soil_returns_none_on_http_error():
    with patch.object(soil, "post_json", side_effect=HttpError("504")):
        assert soil.lookup_soil(47.0, -112.0) is None


def test_soil_handles_missing_optional_fields():
    fake_table = {
        "Table": [
            [
                "mukey",
                "muname",
                "farmlndcl",
                "slopegradwta",
                "drclassdcd",
                "niccdcd",
                "niccdcdpct",
                "flodfreqdcd",
                "hydgrpdcd",
                "brockdepmin",
                "wtdepannmin",
            ],
            ["123", "unknown", None, None, None, None, None, None, None, None, None],
        ]
    }
    with patch.object(soil, "post_json", return_value=fake_table):
        out = soil.lookup_soil(47.0, -112.0)
    assert out is not None
    assert out["mapUnitName"] == "unknown"
    assert out["capabilityClass"] == ""
    assert out["slopePercent"] is None


# ── flood.py ────────────────────────────────────────────────────────────────


def _feature(attrs: dict) -> dict:
    return {"features": [{"attributes": attrs}]}


def test_flood_returns_zone_on_happy_path():
    with patch.object(
        flood,
        "get_json",
        return_value=_feature({"FLD_ZONE": "AE", "SFHA_TF": "T", "STATIC_BFE": 1234.5}),
    ):
        out = flood.lookup_flood_zone(47.0, -112.0)
    assert out == {
        "floodZone": "AE",
        "isSFHA": True,
        "baseFloodElevation": 1234.5,
    }


def test_flood_classifies_zone_x_as_not_sfha():
    with patch.object(
        flood,
        "get_json",
        return_value=_feature({"FLD_ZONE": "X", "SFHA_TF": "F", "STATIC_BFE": -9999}),
    ):
        out = flood.lookup_flood_zone(47.0, -112.0)
    assert out["floodZone"] == "X"
    assert out["isSFHA"] is False
    # -9999 is a FEMA sentinel → filtered out
    assert out["baseFloodElevation"] is None


def test_flood_returns_none_on_no_features():
    with patch.object(flood, "get_json", return_value={"features": []}):
        assert flood.lookup_flood_zone(47.0, -112.0) is None


def test_flood_returns_none_on_http_error():
    with patch.object(flood, "get_json", side_effect=HttpError("504")):
        assert flood.lookup_flood_zone(47.0, -112.0) is None


def test_flood_infers_sfha_from_zone_letter_when_flag_missing():
    with patch.object(
        flood,
        "get_json",
        return_value=_feature({"FLD_ZONE": "A", "SFHA_TF": None}),
    ):
        out = flood.lookup_flood_zone(47.0, -112.0)
    assert out["isSFHA"] is True


# ── elevation.py ────────────────────────────────────────────────────────────


def test_elevation_parses_meters_and_converts_to_feet():
    with patch.object(elevation, "get_json", return_value={"value": "1430.94"}):
        out = elevation.lookup_elevation(47.0, -112.0)
    assert out == {
        "elevationMeters": 1430.9,
        "elevationFeet": 4694.7,
    }


def test_elevation_returns_none_on_no_data_sentinel():
    with patch.object(elevation, "get_json", return_value={"value": -1e10}):
        assert elevation.lookup_elevation(47.0, -112.0) is None


def test_elevation_returns_none_on_non_numeric():
    with patch.object(elevation, "get_json", return_value={"value": "N/A"}):
        assert elevation.lookup_elevation(47.0, -112.0) is None


def test_elevation_returns_none_on_http_error():
    with patch.object(elevation, "get_json", side_effect=HttpError("bad")):
        assert elevation.lookup_elevation(47.0, -112.0) is None


# ── watershed.py ────────────────────────────────────────────────────────────


def test_watershed_happy_path():
    with patch.object(
        watershed,
        "get_json",
        return_value=_feature(
            {
                "huc12": "100301011905",
                "name": "Wolf Creek",
                "areaacres": "24519.83",
                "states": "MT",
            }
        ),
    ):
        out = watershed.lookup_watershed(47.0, -112.0)
    assert out == {
        "huc12": "100301011905",
        "watershedName": "Wolf Creek",
        "areaAcres": 24519.83,
        "states": "MT",
    }


def test_watershed_returns_none_when_huc_missing():
    with patch.object(
        watershed,
        "get_json",
        return_value=_feature({"huc12": None, "name": "foo"}),
    ):
        assert watershed.lookup_watershed(47.0, -112.0) is None


def test_watershed_returns_none_on_no_features():
    with patch.object(watershed, "get_json", return_value={"features": []}):
        assert watershed.lookup_watershed(47.0, -112.0) is None


def test_watershed_returns_none_on_http_error():
    with patch.object(watershed, "get_json", side_effect=HttpError("504")):
        assert watershed.lookup_watershed(47.0, -112.0) is None


# ── orchestrator.py ─────────────────────────────────────────────────────────


def test_orchestrator_aggregates_all_four_sources():
    with patch.object(
        orchestrator, "lookup_soil", return_value={"mapUnitName": "x"}
    ), patch.object(
        orchestrator, "lookup_flood_zone", return_value={"floodZone": "X"}
    ), patch.object(
        orchestrator, "lookup_elevation", return_value={"elevationMeters": 1000}
    ), patch.object(orchestrator, "lookup_watershed", return_value={"huc12": "1"}):
        result = orchestrator.enrich_point(47.0, -112.0)
    assert result["lat"] == 47.0
    assert result["lng"] == -112.0
    assert result["soil"]["mapUnitName"] == "x"
    assert result["flood"]["floodZone"] == "X"
    assert result["elevation"]["elevationMeters"] == 1000
    assert result["watershed"]["huc12"] == "1"


def test_orchestrator_partial_results_when_one_source_fails():
    # FEMA is the classic flaky source — simulate its failure while others succeed
    with patch.object(
        orchestrator, "lookup_soil", return_value={"ok": True}
    ), patch.object(orchestrator, "lookup_flood_zone", return_value=None), patch.object(
        orchestrator, "lookup_elevation", return_value={"m": 1}
    ), patch.object(orchestrator, "lookup_watershed", return_value={"h": 1}):
        result = orchestrator.enrich_point(0.0, 0.0)
    assert result["flood"] is None
    assert result["soil"] == {"ok": True}
    assert result["elevation"] == {"m": 1}
    assert result["watershed"] == {"h": 1}


# ── http_client retry behaviour ─────────────────────────────────────────────


def test_http_client_retries_on_failure(monkeypatch):
    from enrichment import http_client

    # Reduce sleep to zero so tests are fast
    monkeypatch.setattr(http_client.time, "sleep", lambda s: None)

    calls = {"n": 0}

    class FakeResp:
        def __init__(self, body: bytes):
            self._body = body

        def read(self):
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(req, timeout=None):
        calls["n"] += 1
        if calls["n"] < 3:
            raise TimeoutError("transient")
        return FakeResp(b'{"ok": true}')

    monkeypatch.setattr(http_client, "urlopen", fake_urlopen)
    result = http_client.get_json("http://example.com", max_retries=3, backoff=0)
    assert result == {"ok": True}
    assert calls["n"] == 3


def test_http_client_raises_after_max_retries(monkeypatch):
    from enrichment import http_client

    monkeypatch.setattr(http_client.time, "sleep", lambda s: None)

    def always_fail(req, timeout=None):
        raise TimeoutError("always")

    monkeypatch.setattr(http_client, "urlopen", always_fail)
    try:
        http_client.get_json("http://example.com", max_retries=2, backoff=0)
    except http_client.HttpError:
        return
    raise AssertionError("expected HttpError")
