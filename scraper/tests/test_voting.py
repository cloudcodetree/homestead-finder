"""Tests for scraper.enrichment.voting — county join + bucket math."""

from __future__ import annotations

import pytest

from enrichment import voting


TABLE = {
    "MO|reynolds": {"year": 2020, "dPct": 18.6, "rPct": 79.7},
    "AR|phillips": {"year": 2020, "dPct": 60.0, "rPct": 39.0},
    "MO|texas": {"year": 2020, "dPct": 50.0, "rPct": 48.0},  # balanced-ish
}


def _row(state: str, county: str) -> dict:
    return {
        "id": f"{state}_{county}",
        "location": {"state": state, "county": county, "lat": 0, "lng": 0},
    }


@pytest.mark.parametrize(
    "margin,expected",
    [
        (61.1, "strongly_r"),
        (20.0, "strongly_r"),
        (19.9, "lean_r"),
        (5.0, "lean_r"),
        (4.9, "balanced"),
        (-4.9, "balanced"),
        (-5.0, "lean_d"),
        (-19.9, "lean_d"),
        (-20.0, "strongly_d"),
        (-50.0, "strongly_d"),
    ],
)
def test_bucket_thresholds(margin: float, expected: str) -> None:
    assert voting._bucket(margin) == expected


def test_normalize_strips_suffix_and_lowercases() -> None:
    assert voting._normalize_county("Reynolds County") == "reynolds"
    assert voting._normalize_county("REYNOLDS COUNTY") == "reynolds"
    assert voting._normalize_county("Phillips Parish") == "phillips"
    assert voting._normalize_county("Bristol Bay Borough") == "bristol bay"
    assert voting._normalize_county("  reynolds   ") == "reynolds"
    assert voting._normalize_county(None) == ""


def test_enrich_stamps_matched_listings() -> None:
    rows = [
        _row("MO", "Reynolds County"),
        _row("AR", "Phillips County"),
        _row("MO", "Unknown County"),
    ]
    n = voting.enrich(rows, table=TABLE)
    assert n == 2
    assert rows[0]["votingPattern"]["bucket"] == "strongly_r"
    assert rows[0]["votingPattern"]["marginPp"] == pytest.approx(61.1, abs=0.01)
    assert rows[1]["votingPattern"]["bucket"] == "strongly_d"  # AR Phillips is D
    assert "votingPattern" not in rows[2]


def test_enrich_is_idempotent_without_overwrite() -> None:
    rows = [_row("MO", "Reynolds County")]
    voting.enrich(rows, table=TABLE)
    # Second call should be a no-op since the field already exists.
    n = voting.enrich(rows, table=TABLE)
    assert n == 0


def test_enrich_overwrite_replaces_existing() -> None:
    rows = [_row("MO", "Reynolds County")]
    rows[0]["votingPattern"] = {"year": 1900, "dPct": 0, "rPct": 0, "marginPp": 0, "bucket": "balanced"}
    n = voting.enrich(rows, table=TABLE, overwrite=True)
    assert n == 1
    assert rows[0]["votingPattern"]["year"] == 2020


def test_enrich_handles_county_without_suffix() -> None:
    """Some scraper sources emit 'Reynolds' without the 'County' suffix.
    The normalizer must collapse both shapes to the same key."""
    rows = [_row("MO", "Reynolds")]
    n = voting.enrich(rows, table=TABLE)
    assert n == 1
    assert rows[0]["votingPattern"]["bucket"] == "strongly_r"


def test_enrich_no_op_when_table_is_empty() -> None:
    assert voting.enrich([_row("MO", "Reynolds")], table={}) == 0


def test_enrich_skips_listings_with_blank_state_or_county() -> None:
    rows = [
        {"id": "x", "location": {"state": "", "county": "Reynolds"}},
        {"id": "y", "location": {"state": "MO", "county": ""}},
        {"id": "z", "location": {}},
    ]
    assert voting.enrich(rows, table=TABLE) == 0
