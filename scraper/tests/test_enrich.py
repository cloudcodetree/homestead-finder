"""Tests for scraper/enrich.py orchestration and sanitization.

call_json is mocked — no subprocess runs here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

# Ensure scraper root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

import enrich


# ── _sanitize_enrichment ────────────────────────────────────────────────────


def test_sanitize_returns_none_for_non_dict():
    assert enrich._sanitize_enrichment([]) is None
    assert enrich._sanitize_enrichment(None) is None
    assert enrich._sanitize_enrichment("string") is None


def test_sanitize_drops_unknown_tags():
    raw = {
        "aiTags": ["off_grid_viable", "fake_tag", "water_rights_present"],
        "homesteadFitScore": 50,
        "redFlags": [],
        "aiSummary": "ok",
    }
    out = enrich._sanitize_enrichment(raw)
    assert out is not None
    assert out["aiTags"] == ["off_grid_viable", "water_rights_present"]


def test_sanitize_drops_unknown_red_flags():
    raw = {
        "aiTags": [],
        "homesteadFitScore": 50,
        "redFlags": ["no_water_source", "invented_flag"],
        "aiSummary": "x",
    }
    out = enrich._sanitize_enrichment(raw)
    assert out["redFlags"] == ["no_water_source"]


def test_sanitize_clamps_fit_score_to_0_100():
    raw = {"aiTags": [], "homesteadFitScore": 250, "redFlags": [], "aiSummary": ""}
    assert enrich._sanitize_enrichment(raw)["homesteadFitScore"] == 100

    raw["homesteadFitScore"] = -50
    assert enrich._sanitize_enrichment(raw)["homesteadFitScore"] == 0


def test_sanitize_coerces_nonint_fit_score_to_zero():
    raw = {
        "aiTags": [],
        "homesteadFitScore": "not a number",
        "redFlags": [],
        "aiSummary": "",
    }
    assert enrich._sanitize_enrichment(raw)["homesteadFitScore"] == 0


def test_sanitize_truncates_summary_to_600_chars():
    raw = {
        "aiTags": [],
        "homesteadFitScore": 50,
        "redFlags": [],
        "aiSummary": "x" * 1000,
    }
    out = enrich._sanitize_enrichment(raw)
    assert len(out["aiSummary"]) == 600


def test_sanitize_coerces_nonstring_tags_to_empty_list():
    raw = {
        "aiTags": "not a list",
        "homesteadFitScore": 50,
        "redFlags": None,
        "aiSummary": "",
    }
    out = enrich._sanitize_enrichment(raw)
    assert out["aiTags"] == []
    assert out["redFlags"] == []


def test_sanitize_handles_non_string_tag_entries():
    raw = {
        "aiTags": ["off_grid_viable", 42, None, "no_hoa"],
        "homesteadFitScore": 50,
        "redFlags": [],
        "aiSummary": "",
    }
    out = enrich._sanitize_enrichment(raw)
    assert out["aiTags"] == ["off_grid_viable", "no_hoa"]


# ── _content_hash ───────────────────────────────────────────────────────────


def _base_listing() -> dict:
    return {
        "id": "x_1",
        "title": "80 acres",
        "description": "creek access",
        "price": 40000,
        "acreage": 80,
        "location": {"state": "MT", "county": "Carbon"},
    }


def test_content_hash_is_stable_across_calls():
    a = _base_listing()
    assert enrich._content_hash(a) == enrich._content_hash(a)


def test_content_hash_changes_when_title_changes():
    a = _base_listing()
    b = dict(a)
    b["title"] = "different"
    assert enrich._content_hash(a) != enrich._content_hash(b)


def test_content_hash_changes_when_description_changes():
    a = _base_listing()
    b = dict(a)
    b["description"] = "different"
    assert enrich._content_hash(a) != enrich._content_hash(b)


def test_content_hash_changes_when_price_changes():
    a = _base_listing()
    b = dict(a)
    b["price"] = 50000
    assert enrich._content_hash(a) != enrich._content_hash(b)


def test_content_hash_is_stable_when_id_changes():
    """ID isn't part of the hash — enrichment doesn't depend on it."""
    a = _base_listing()
    b = dict(a)
    b["id"] = "something_else"
    assert enrich._content_hash(a) == enrich._content_hash(b)


# ── _needs_enrichment ───────────────────────────────────────────────────────


def test_needs_enrichment_true_when_never_enriched():
    assert enrich._needs_enrichment(_base_listing(), force=False) is True


def test_needs_enrichment_true_when_forced_even_if_already_done():
    listing = _base_listing()
    listing["enrichedAt"] = "2026-01-01T00:00:00+00:00"
    listing["_enrichHash"] = enrich._content_hash(listing)
    assert enrich._needs_enrichment(listing, force=True) is True


def test_needs_enrichment_false_when_hash_matches():
    listing = _base_listing()
    listing["enrichedAt"] = "2026-01-01T00:00:00+00:00"
    listing["_enrichHash"] = enrich._content_hash(listing)
    assert enrich._needs_enrichment(listing, force=False) is False


def test_needs_enrichment_true_when_hash_stale():
    listing = _base_listing()
    listing["enrichedAt"] = "2026-01-01T00:00:00+00:00"
    listing["_enrichHash"] = "stale-hash"
    assert enrich._needs_enrichment(listing, force=False) is True


# ── enrich_file (end-to-end orchestration with mocked LLM) ──────────────────


def _good_enrichment_response(*args, **kwargs):
    return {
        "aiTags": ["off_grid_viable"],
        "homesteadFitScore": 70,
        "redFlags": [],
        "aiSummary": "Good for homesteading.",
    }


def test_enrich_file_writes_all_fields_and_hash(tmp_path):
    listings = [_base_listing()]
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps(listings))

    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(enrich, "call_json", side_effect=_good_enrichment_response),
    ):
        counters = enrich.enrich_file(input_file, output_file)

    result = json.loads(output_file.read_text())
    assert counters["enriched"] == 1
    assert counters["failed"] == 0
    assert counters["skipped"] == 0
    assert result[0]["homesteadFitScore"] == 70
    assert result[0]["aiTags"] == ["off_grid_viable"]
    assert "enrichedAt" in result[0]
    assert result[0]["_enrichHash"] == enrich._content_hash(listings[0])


def test_enrich_file_skips_already_enriched(tmp_path):
    listing = _base_listing()
    listing["enrichedAt"] = "2026-01-01T00:00:00+00:00"
    listing["_enrichHash"] = enrich._content_hash(listing)
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps([listing]))

    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(enrich, "call_json") as call,
    ):
        counters = enrich.enrich_file(input_file, output_file)

    call.assert_not_called()
    assert counters["enriched"] == 0
    assert counters["skipped"] == 1


def test_enrich_file_respects_limit(tmp_path):
    listings = [dict(_base_listing(), id=f"x_{i}") for i in range(5)]
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps(listings))

    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(
            enrich, "call_json", side_effect=_good_enrichment_response
        ) as call,
    ):
        counters = enrich.enrich_file(input_file, output_file, limit=2)

    assert call.call_count == 2
    assert counters["enriched"] == 2
    assert counters["skipped"] == 3  # the 3 over the limit


def test_enrich_file_counts_failures_without_corrupting_listing(tmp_path):
    listings = [_base_listing()]
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps(listings))

    # call_json raises — should be caught and count as failure
    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(enrich, "call_json", side_effect=enrich.LLMCallFailed("nope")),
    ):
        counters = enrich.enrich_file(input_file, output_file)

    result = json.loads(output_file.read_text())
    assert counters["failed"] == 1
    assert counters["enriched"] == 0
    # Listing should still be present but unenriched
    assert len(result) == 1
    assert "enrichedAt" not in result[0]


def test_enrich_listing_returns_none_on_invalid_model_output():
    with patch.object(enrich, "call_json", return_value="not a dict"):
        assert enrich.enrich_listing(_base_listing()) is None


def test_enrich_file_raises_when_claude_unavailable(tmp_path):
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text("[]")

    with patch.object(enrich, "is_available", return_value=False):
        try:
            enrich.enrich_file(input_file, output_file)
        except enrich.LLMUnavailable:
            return
    raise AssertionError("expected LLMUnavailable")


def test_enrich_file_rejects_non_array(tmp_path):
    input_file = tmp_path / "in.json"
    input_file.write_text('{"not": "an array"}')

    with patch.object(enrich, "is_available", return_value=True):
        try:
            enrich.enrich_file(input_file, tmp_path / "out.json")
        except ValueError:
            return
    raise AssertionError("expected ValueError")


def test_enrich_file_concurrency_preserves_listing_order(tmp_path):
    """With parallelism, completion order != input order, but output order
    must still match input order (we write back by index)."""
    listings = [
        dict(_base_listing(), id=f"id_{i}", title=f"Listing {i}") for i in range(8)
    ]
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps(listings))

    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(enrich, "call_json", side_effect=_good_enrichment_response),
    ):
        counters = enrich.enrich_file(input_file, output_file, concurrency=4)

    result = json.loads(output_file.read_text())
    assert [r["id"] for r in result] == [f"id_{i}" for i in range(8)]
    assert counters["enriched"] == 8


def test_enrich_file_persists_all_completed_work(tmp_path):
    """All successfully-enriched listings should end up on disk."""
    listings = [dict(_base_listing(), id=f"id_{i}") for i in range(3)]
    input_file = tmp_path / "in.json"
    output_file = tmp_path / "out.json"
    input_file.write_text(json.dumps(listings))

    with (
        patch.object(enrich, "is_available", return_value=True),
        patch.object(enrich, "call_json", side_effect=_good_enrichment_response),
    ):
        enrich.enrich_file(input_file, output_file, concurrency=2)

    result = json.loads(output_file.read_text())
    assert all(item.get("enrichedAt") for item in result)
    assert len(result) == 3
