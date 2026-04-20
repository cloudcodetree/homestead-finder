"""Tests for scraper/curate.py prerank, sanitize_curation, and orchestration."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import curate


# ── _prerank_candidates ─────────────────────────────────────────────────────


def _lst(id_, deal=50, fit=50, flags=None, enriched=True) -> dict:
    out = {
        "id": id_,
        "dealScore": deal,
        "homesteadFitScore": fit,
        "redFlags": flags or [],
    }
    if enriched:
        out["enrichedAt"] = "2026-01-01T00:00:00+00:00"
    return out


def test_prerank_skips_unenriched():
    items = [_lst("a", enriched=False), _lst("b")]
    out = curate._prerank_candidates(items, limit=10)
    assert [item["id"] for item in out] == ["b"]


def test_prerank_orders_by_combined_score():
    # combined = 0.4*deal + 0.6*fit - (3 * severity per flag)
    # No flags on any of these — pure score comparison.
    items = [
        _lst("low", deal=10, fit=10),  # 10
        _lst("highFit", deal=20, fit=90),  # 62
        _lst("highDeal", deal=90, fit=20),  # 48
        _lst("topNoFlags", deal=80, fit=80),  # 80
    ]
    out = curate._prerank_candidates(items, limit=4)
    ids = [item["id"] for item in out]
    assert ids == ["topNoFlags", "highFit", "highDeal", "low"]


def test_prerank_penalizes_high_severity_flags_more():
    # no_water_source = severity 5 → penalty 15
    # extreme_remote = severity 2 → penalty 6
    # A listing with two severity-2 flags (penalty 12) should still outrank
    # one with a single severity-5 flag (penalty 15), even with equal base score.
    items = [
        _lst("severe", deal=80, fit=80, flags=["no_water_source"]),  # 80 - 15 = 65
        _lst(
            "minor",
            deal=80,
            fit=80,
            flags=["extreme_remote", "extreme_remote"],
        ),  # 80 - 12 = 68
    ]
    out = curate._prerank_candidates(items, limit=2)
    ids = [item["id"] for item in out]
    assert ids == ["minor", "severe"]


def test_prerank_respects_limit():
    items = [_lst(f"id{i}", deal=i, fit=i) for i in range(20)]
    out = curate._prerank_candidates(items, limit=5)
    assert len(out) == 5


def test_prerank_empty_input():
    assert curate._prerank_candidates([], limit=10) == []


# ── _compact_listing ────────────────────────────────────────────────────────


def test_compact_listing_handles_missing_fields():
    minimal = {"id": "x"}
    out = curate._compact_listing(minimal)
    assert out["id"] == "x"
    assert out["state"] == ""
    assert out["county"] == ""
    assert out["aiTags"] == []
    assert out["redFlags"] == []
    assert out["aiSummary"] == ""


def test_compact_listing_truncates_long_title():
    out = curate._compact_listing({"id": "x", "title": "a" * 500})
    assert len(out["title"]) <= 120


# ── _sanitize_curation ──────────────────────────────────────────────────────


def test_sanitize_curation_renumbers_ranks_from_one():
    valid = {"a", "b", "c"}
    raw = {
        "picks": [
            {"id": "c", "rank": 99, "headline": "C", "reason": "c"},
            {"id": "a", "rank": 42, "headline": "A", "reason": "a"},
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=10)
    assert [p["rank"] for p in out] == [1, 2]
    assert [p["id"] for p in out] == ["c", "a"]


def test_sanitize_curation_drops_unknown_ids():
    valid = {"a", "b"}
    raw = {
        "picks": [
            {"id": "a", "rank": 1, "headline": "A", "reason": "a"},
            {"id": "ghost", "rank": 2, "headline": "G", "reason": "g"},
            {"id": "b", "rank": 3, "headline": "B", "reason": "b"},
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=10)
    assert [p["id"] for p in out] == ["a", "b"]


def test_sanitize_curation_dedupes():
    valid = {"a"}
    raw = {
        "picks": [
            {"id": "a", "rank": 1, "headline": "A", "reason": "a"},
            {"id": "a", "rank": 2, "headline": "A again", "reason": "a"},
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=10)
    assert len(out) == 1


def test_sanitize_curation_truncates_to_expected_count():
    valid = {f"id{i}" for i in range(10)}
    raw = {
        "picks": [
            {"id": f"id{i}", "rank": i + 1, "headline": "h", "reason": "r"}
            for i in range(10)
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=3)
    assert len(out) == 3


def test_sanitize_curation_raises_on_non_dict():
    with pytest.raises(curate.LLMCallFailed):
        curate._sanitize_curation("not a dict", {"a"}, expected_count=1)


def test_sanitize_curation_raises_when_picks_missing():
    with pytest.raises(curate.LLMCallFailed, match="missing 'picks'"):
        curate._sanitize_curation({"wrong": []}, {"a"}, expected_count=1)


def test_sanitize_curation_truncates_long_reason_and_headline():
    valid = {"a"}
    raw = {
        "picks": [
            {
                "id": "a",
                "rank": 1,
                "headline": "x" * 500,
                "reason": "y" * 2000,
            }
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=10)
    assert len(out[0]["headline"]) <= 120
    assert len(out[0]["reason"]) <= 800


def test_sanitize_curation_ignores_non_dict_picks():
    valid = {"a"}
    raw = {
        "picks": [
            "not a dict",
            {"id": "a", "rank": 1, "headline": "h", "reason": "r"},
            None,
        ]
    }
    out = curate._sanitize_curation(raw, valid, expected_count=10)
    assert len(out) == 1
    assert out[0]["id"] == "a"


# ── curate() end-to-end (LLM mocked) ────────────────────────────────────────


def test_curate_writes_output_file(tmp_path):
    items = [_lst(f"x_{i}", deal=60 + i, fit=60 + i) for i in range(5)]
    input_file = tmp_path / "listings.json"
    output_file = tmp_path / "curated.json"
    input_file.write_text(json.dumps(items))

    def fake_call_json(prompt, **kwargs):
        # Return a valid curation response for the top 3 items
        return {
            "picks": [
                {"id": "x_4", "rank": 1, "headline": "Best", "reason": "top"},
                {"id": "x_3", "rank": 2, "headline": "Runner-up", "reason": "good"},
                {"id": "x_2", "rank": 3, "headline": "Third", "reason": "ok"},
            ]
        }

    with (
        patch.object(curate, "is_available", return_value=True),
        patch.object(curate, "call_json", side_effect=fake_call_json),
    ):
        result = curate.curate(input_file, output_file, pick_count=3, candidate_count=5)

    on_disk = json.loads(output_file.read_text())
    assert on_disk["pickCount"] == 3
    assert on_disk["candidateCount"] == 5
    assert [p["id"] for p in on_disk["picks"]] == ["x_4", "x_3", "x_2"]
    assert result["picks"][0]["rank"] == 1


def test_curate_caps_pick_count_when_candidates_scarce(tmp_path):
    items = [_lst("only_one")]
    input_file = tmp_path / "listings.json"
    output_file = tmp_path / "curated.json"
    input_file.write_text(json.dumps(items))

    with (
        patch.object(curate, "is_available", return_value=True),
        patch.object(
            curate,
            "call_json",
            return_value={
                "picks": [{"id": "only_one", "rank": 1, "headline": "h", "reason": "r"}]
            },
        ),
    ):
        result = curate.curate(
            input_file, output_file, pick_count=10, candidate_count=10
        )
    assert result["pickCount"] == 1


def test_curate_raises_when_nothing_enriched(tmp_path):
    items = [_lst("a", enriched=False)]
    input_file = tmp_path / "listings.json"
    output_file = tmp_path / "curated.json"
    input_file.write_text(json.dumps(items))

    with patch.object(curate, "is_available", return_value=True):
        with pytest.raises(ValueError, match="no enriched listings"):
            curate.curate(input_file, output_file)


def test_curate_raises_when_claude_unavailable(tmp_path):
    input_file = tmp_path / "listings.json"
    input_file.write_text("[]")

    with patch.object(curate, "is_available", return_value=False):
        with pytest.raises(curate.LLMUnavailable):
            curate.curate(input_file, tmp_path / "curated.json")
