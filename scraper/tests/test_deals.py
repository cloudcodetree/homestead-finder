"""Tests for the homestead-deal hard filters + composite scoring.

These are pure-function tests; the Claude-backed `generate_deals` is
smoke-tested separately against a mocked call_json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import deals


# ── fixtures ───────────────────────────────────────────────────────────────


def _good_listing(**overrides):
    """Start from a generously-specified gem so individual tests can
    make it fail one gate at a time via overrides."""
    base = {
        "id": "landwatch_test_ok",
        "price": 150_000,
        "acreage": 20,
        "dealScore": 60,
        "homesteadFitScore": 75,
        "aiTags": ["year_round_water", "build_ready", "off_grid_viable"],
        "redFlags": [],
        "features": ["water_creek"],
        "source": "landwatch",
        "status": None,
        "geoEnrichment": {
            "flood": {"floodZone": "X", "isSFHA": False},
            "soil": {"capabilityClass": "3", "mapUnitName": "Soil X"},
        },
    }
    base.update(overrides)
    return base


# ── hard filters ───────────────────────────────────────────────────────────


def test_hard_filter_accepts_good_listing():
    ok, why = deals.passes_hard_filters(_good_listing())
    assert ok, why


def test_tax_sale_status_is_excluded():
    ok, why = deals.passes_hard_filters(_good_listing(status="tax_sale"))
    assert not ok
    assert "tax_sale" in why


def test_price_over_cap_excluded():
    ok, why = deals.passes_hard_filters(_good_listing(price=600_000))
    assert not ok and "price" in why


def test_price_zero_or_negative_excluded():
    assert not deals.passes_hard_filters(_good_listing(price=0))[0]
    assert not deals.passes_hard_filters(_good_listing(price=-1))[0]


def test_acreage_below_floor_excluded():
    ok, why = deals.passes_hard_filters(_good_listing(acreage=3))
    assert not ok and "acreage" in why


def test_critical_red_flag_excluded():
    ok, why = deals.passes_hard_filters(_good_listing(redFlags=["no_water_source"]))
    assert not ok and "red flag" in why


def test_sfha_floodplain_excluded_by_zone():
    bad = _good_listing()
    bad["geoEnrichment"]["flood"]["floodZone"] = "AE"
    bad["geoEnrichment"]["flood"]["isSFHA"] = True
    ok, why = deals.passes_hard_filters(bad)
    assert not ok and "floodplain" in why.lower()


def test_soil_class_above_six_excluded():
    bad = _good_listing()
    bad["geoEnrichment"]["soil"]["capabilityClass"] = "7"
    ok, why = deals.passes_hard_filters(bad)
    assert not ok and "soil" in why.lower()


def test_soil_class_six_is_still_allowed():
    marginal = _good_listing()
    marginal["geoEnrichment"]["soil"]["capabilityClass"] = "6"
    ok, _ = deals.passes_hard_filters(marginal)
    assert ok


def test_missing_geo_data_does_not_exclude():
    """No soil/flood data → we can't filter on it; let it through."""
    unsized = _good_listing(geoEnrichment={})
    ok, _ = deals.passes_hard_filters(unsized)
    assert ok


# ── composite score ────────────────────────────────────────────────────────


def test_score_baseline_uses_weighted_deal_and_fit():
    # 0.25 * 60 + 0.45 * 75 = 15 + 33.75 = 48.75, plus water/buildability/etc
    s = deals.score_candidate(_good_listing())
    assert s > 48.75  # bonuses push it above the base


def test_water_signal_adds_points():
    with_water = _good_listing(aiTags=["year_round_water"])
    dry = _good_listing(aiTags=["no_water_mentioned"], features=[])
    assert deals.score_candidate(with_water) > deals.score_candidate(dry)


def test_better_soil_scores_higher():
    cls2 = _good_listing()
    cls2["geoEnrichment"]["soil"]["capabilityClass"] = "2"
    cls5 = _good_listing()
    cls5["geoEnrichment"]["soil"]["capabilityClass"] = "5"
    assert deals.score_candidate(cls2) > deals.score_candidate(cls5)


def test_sweet_spot_acreage_bonus():
    sweet = _good_listing(acreage=20)  # inside 10-40
    big = _good_listing(acreage=300)  # >160
    assert deals.score_candidate(sweet) > deals.score_candidate(big)


def test_multiple_red_flags_penalized():
    one = _good_listing(redFlags=["easement_concerns"])
    three = _good_listing(
        redFlags=["easement_concerns", "requires_well_drilling", "extreme_remote"]
    )
    assert deals.score_candidate(one) > deals.score_candidate(three)


def test_extreme_remote_tag_penalized():
    tame = _good_listing()
    remote = _good_listing(redFlags=["extreme_remote"])
    assert deals.score_candidate(tame) > deals.score_candidate(remote)


# ── generate_deals orchestration (mock the LLM) ───────────────────────────


def _write_listings(tmp_path: Path, items: list[dict]) -> Path:
    p = tmp_path / "listings.json"
    p.write_text(json.dumps(items))
    return p


def _fake_sonnet_ranking(candidate_ids: list[str]):
    def _fake(prompt, **kwargs):  # noqa: ARG001
        # Return them in input order — tests just need a valid shape
        return {
            "picks": [
                {"id": cid, "rank": i + 1, "headline": f"#{i+1}", "reason": "…"}
                for i, cid in enumerate(candidate_ids)
            ]
        }

    return _fake


def test_generate_deals_filters_then_picks(tmp_path):
    listings = [
        _good_listing(id=f"good_{i}", homesteadFitScore=70 + i) for i in range(5)
    ] + [
        _good_listing(id="bad_price", price=600_000),
        _good_listing(id="bad_acres", acreage=2),
        _good_listing(id="bad_tax", status="tax_sale"),
    ]
    input_path = _write_listings(tmp_path, listings)
    output_path = tmp_path / "deals.json"

    with patch.object(deals, "is_available", return_value=True), patch.object(
        deals,
        "call_json",
        side_effect=_fake_sonnet_ranking([f"good_{i}" for i in range(4, -1, -1)]),
    ):
        result = deals.generate_deals(
            input_path, output_path, pick_count=5, candidate_count=5
        )

    assert result["passedFiltersCount"] == 5
    # Highest homesteadFitScore should pre-rank first → the Sonnet mock
    # preserves input order, so the rank-1 pick should be good_4.
    assert result["picks"][0]["id"] == "good_4"
    assert result["pickCount"] == 5
    assert result["filterSummary"]["minAcres"] == deals.MIN_ACRES


def test_generate_deals_shrinks_pick_count_when_pool_small(tmp_path):
    listings = [_good_listing(id="only")]
    input_path = _write_listings(tmp_path, listings)
    output_path = tmp_path / "deals.json"
    with patch.object(deals, "is_available", return_value=True), patch.object(
        deals, "call_json", side_effect=_fake_sonnet_ranking(["only"])
    ):
        result = deals.generate_deals(
            input_path, output_path, pick_count=12, candidate_count=20
        )
    assert result["pickCount"] == 1


def test_generate_deals_raises_when_nothing_passes(tmp_path):
    listings = [_good_listing(id="x", status="tax_sale")]
    input_path = _write_listings(tmp_path, listings)
    with patch.object(deals, "is_available", return_value=True):
        with pytest.raises(ValueError, match="no listings pass"):
            deals.generate_deals(input_path, tmp_path / "out.json")


def test_generate_deals_raises_when_claude_unavailable(tmp_path):
    input_path = _write_listings(tmp_path, [_good_listing(id="x")])
    with patch.object(deals, "is_available", return_value=False):
        with pytest.raises(deals.LLMUnavailable):
            deals.generate_deals(input_path, tmp_path / "out.json")
