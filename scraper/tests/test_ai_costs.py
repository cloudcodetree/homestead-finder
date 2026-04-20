"""Tests for scraper/ai_costs.py (cost-record logging and summarization)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import ai_costs


def _point_log_at(monkeypatch, path: Path) -> None:
    monkeypatch.setattr(ai_costs, "COST_LOG", path)


def test_record_appends_one_line(monkeypatch, tmp_path):
    _point_log_at(monkeypatch, tmp_path / "costs.jsonl")
    ai_costs.record(
        model="haiku",
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.001,
        cached=False,
        tag="enrich",
    )
    lines = (tmp_path / "costs.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["model"] == "haiku"
    assert entry["input_tokens"] == 100
    assert entry["tag"] == "enrich"
    assert entry["cached"] is False
    assert "ts" in entry


def test_record_creates_parent_dir(monkeypatch, tmp_path):
    deep = tmp_path / "nested" / "path" / "costs.jsonl"
    _point_log_at(monkeypatch, deep)
    ai_costs.record(model="haiku", input_tokens=1, output_tokens=1, cost_usd=0)
    assert deep.exists()


def test_record_swallows_oserror(monkeypatch, tmp_path):
    # Point at a path that will fail (a file where parent is a regular file)
    blocker = tmp_path / "blocker"
    blocker.write_text("")
    _point_log_at(monkeypatch, blocker / "sub" / "costs.jsonl")
    # Should not raise — ai_costs is observational only
    ai_costs.record(model="haiku", input_tokens=1, output_tokens=1, cost_usd=0)


def test_summarize_aggregates_totals(monkeypatch, tmp_path):
    log = tmp_path / "costs.jsonl"
    _point_log_at(monkeypatch, log)
    ai_costs.record(
        model="haiku", input_tokens=100, output_tokens=50, cost_usd=0.001, tag="enrich"
    )
    ai_costs.record(
        model="haiku", input_tokens=200, output_tokens=75, cost_usd=0.002, tag="enrich"
    )
    ai_costs.record(
        model="sonnet",
        input_tokens=1000,
        output_tokens=500,
        cost_usd=0.05,
        tag="curate",
    )
    ai_costs.record(
        model="haiku",
        input_tokens=0,
        output_tokens=0,
        cost_usd=0,
        cached=True,
        tag="enrich",
    )

    totals = ai_costs.summarize()
    assert totals["calls"] == 4
    assert totals["cached_calls"] == 1
    assert totals["input_tokens"] == 1300
    assert totals["output_tokens"] == 625
    assert totals["cost_usd"] == 0.053
    assert totals["by_model"]["haiku"] == 3
    assert totals["by_model"]["sonnet"] == 1
    assert totals["by_tag"]["enrich"] == 3
    assert totals["by_tag"]["curate"] == 1


def test_summarize_filters_by_tag(monkeypatch, tmp_path):
    _point_log_at(monkeypatch, tmp_path / "costs.jsonl")
    ai_costs.record(
        model="haiku", input_tokens=1, output_tokens=1, cost_usd=1, tag="enrich"
    )
    ai_costs.record(
        model="haiku", input_tokens=1, output_tokens=1, cost_usd=1, tag="curate"
    )

    totals = ai_costs.summarize(tag="enrich")
    assert totals["calls"] == 1
    assert totals["cost_usd"] == 1


def test_summarize_filters_by_since(monkeypatch, tmp_path):
    log = tmp_path / "costs.jsonl"
    # Write two entries manually with controlled timestamps
    old = datetime.now(timezone.utc) - timedelta(days=10)
    recent = datetime.now(timezone.utc) - timedelta(minutes=5)
    log.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "ts": old.isoformat(),
                        "model": "haiku",
                        "input_tokens": 1,
                        "output_tokens": 1,
                        "cost_usd": 1.0,
                        "cached": False,
                    }
                ),
                json.dumps(
                    {
                        "ts": recent.isoformat(),
                        "model": "haiku",
                        "input_tokens": 1,
                        "output_tokens": 1,
                        "cost_usd": 2.0,
                        "cached": False,
                    }
                ),
            ]
        )
        + "\n"
    )
    _point_log_at(monkeypatch, log)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    totals = ai_costs.summarize(since=cutoff)
    assert totals["calls"] == 1
    assert totals["cost_usd"] == 2.0


def test_summarize_ignores_malformed_lines(monkeypatch, tmp_path):
    log = tmp_path / "costs.jsonl"
    log.write_text(
        '{"ts":"2026-01-01T00:00:00+00:00","model":"haiku","input_tokens":1,"output_tokens":1,"cost_usd":1,"cached":false}\n'
        "not valid json\n"
        "\n"  # blank line
    )
    _point_log_at(monkeypatch, log)
    totals = ai_costs.summarize()
    assert totals["calls"] == 1


def test_summarize_with_no_log_file(monkeypatch, tmp_path):
    _point_log_at(monkeypatch, tmp_path / "nope.jsonl")
    totals = ai_costs.summarize()
    assert totals["calls"] == 0
    assert totals["cost_usd"] == 0
