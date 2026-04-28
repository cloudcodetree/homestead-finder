"""Test the DAG topology + skip env vars + error containment."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import pass_runner
from pass_runner import Ctx, Pass


def _write_corpus(tmp_path: Path, listings: list[dict]) -> Path:
    p = tmp_path / "listings.json"
    p.write_text(json.dumps(listings))
    return p


def test_runs_passes_in_dependency_order(tmp_path: Path) -> None:
    """A → B → C; C depends on B, B depends on A. Order must be A, B, C
    regardless of how the input list is ordered."""
    order: list[str] = []

    def make(name: str):
        def run(ctx: Ctx) -> None:
            order.append(name)
        return run

    passes = [
        Pass(name="C", run=make("C"), depends_on=("B",)),
        Pass(name="A", run=make("A")),
        Pass(name="B", run=make("B"), depends_on=("A",)),
    ]
    listings_path = _write_corpus(tmp_path, [{"id": "x"}])
    pass_runner.run_pipeline(listings_path, passes)
    assert order == ["A", "B", "C"]


def test_passes_share_in_memory_corpus(tmp_path: Path) -> None:
    """A pass's mutation is visible to subsequent passes — the whole
    point of the runner is to avoid round-tripping through JSON."""

    def add_field(ctx: Ctx) -> None:
        for r in ctx.listings:
            r["touched_by_a"] = True

    def assert_seen(ctx: Ctx) -> None:
        for r in ctx.listings:
            assert r.get("touched_by_a") is True

    passes = [
        Pass(name="a", run=add_field),
        Pass(name="b", run=assert_seen, depends_on=("a",)),
    ]
    listings_path = _write_corpus(tmp_path, [{"id": "1"}, {"id": "2"}])
    pass_runner.run_pipeline(listings_path, passes)


def test_writes_corpus_back_when_write_back_true(tmp_path: Path) -> None:
    def stamp(ctx: Ctx) -> None:
        for r in ctx.listings:
            r["stamped"] = True

    listings_path = _write_corpus(tmp_path, [{"id": "1"}])
    pass_runner.run_pipeline(
        listings_path, [Pass(name="stamp", run=stamp)], write_back=True
    )
    after = json.loads(listings_path.read_text())
    assert after == [{"id": "1", "stamped": True}]


def test_does_not_write_when_write_back_false(tmp_path: Path) -> None:
    def stamp(ctx: Ctx) -> None:
        for r in ctx.listings:
            r["stamped"] = True

    listings_path = _write_corpus(tmp_path, [{"id": "1"}])
    pass_runner.run_pipeline(
        listings_path, [Pass(name="stamp", run=stamp)], write_back=False
    )
    after = json.loads(listings_path.read_text())
    assert after == [{"id": "1"}]  # untouched on disk


def test_skip_env_bypasses_pass(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SKIP_X", "1")
    ran: list[str] = []

    def x(ctx: Ctx) -> None:
        ran.append("x")

    listings_path = _write_corpus(tmp_path, [{"id": "1"}])
    report = pass_runner.run_pipeline(
        listings_path, [Pass(name="x", run=x, skip_env="SKIP_X")]
    )
    assert ran == []
    assert report["passes"][0]["status"] == "skipped"


def test_one_pass_failing_does_not_block_subsequent_passes(tmp_path: Path) -> None:
    """A broken `enrich` shouldn't prevent `health_check` from running.
    The runner records the error and keeps going."""
    ran: list[str] = []

    def boom(ctx: Ctx) -> None:
        raise RuntimeError("ouch")

    def ok(ctx: Ctx) -> None:
        ran.append("ok")

    listings_path = _write_corpus(tmp_path, [{"id": "1"}])
    report = pass_runner.run_pipeline(
        listings_path,
        [
            Pass(name="boom", run=boom),
            Pass(name="after", run=ok, depends_on=("boom",)),
        ],
    )
    # `after` still ran — the runner doesn't know whether `boom`s
    # output was needed. Letting subsequent passes try is more useful
    # than aborting the pipeline.
    assert ran == ["ok"]
    statuses = {p["name"]: p["status"] for p in report["passes"]}
    assert statuses == {"boom": "error", "after": "ok"}


def test_cyclic_dependency_raises(tmp_path: Path) -> None:
    listings_path = _write_corpus(tmp_path, [])
    with pytest.raises(ValueError, match="Cyclic"):
        pass_runner.run_pipeline(
            listings_path,
            [
                Pass(name="a", run=lambda c: None, depends_on=("b",)),
                Pass(name="b", run=lambda c: None, depends_on=("a",)),
            ],
        )


def test_unknown_dependency_raises(tmp_path: Path) -> None:
    listings_path = _write_corpus(tmp_path, [])
    with pytest.raises(ValueError, match="unknown pass"):
        pass_runner.run_pipeline(
            listings_path,
            [Pass(name="a", run=lambda c: None, depends_on=("missing",))],
        )


def test_empty_corpus_is_a_noop(tmp_path: Path) -> None:
    """Missing file should log + return empty report; not throw."""
    report = pass_runner.run_pipeline(tmp_path / "nonexistent.json", [])
    assert report == {"loaded": 0, "passes": []}


def test_notes_propagate_to_report(tmp_path: Path) -> None:
    def annotate(ctx: Ctx) -> None:
        ctx.note("touched", 42)

    listings_path = _write_corpus(tmp_path, [{"id": "1"}])
    report = pass_runner.run_pipeline(
        listings_path, [Pass(name="annotate", run=annotate)]
    )
    assert report["notes"] == {"touched": 42}
