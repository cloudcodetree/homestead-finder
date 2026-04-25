"""Tests for the schema versioning + migration framework.

Today there are no migrations defined — v1 is the current shape.
These tests pin the framework's invariants so when we DO add the
first migration (v1→v2), we don't accidentally break the stamping
or walk-forward semantics.
"""

from __future__ import annotations

import schema_migrate as sm


def test_stamp_adds_schema_version():
    out = sm.stamp({"id": "x", "title": "y"})
    assert out["_schemaVersion"] == sm.CURRENT_VERSION
    # Original input untouched (purity)
    assert "_schemaVersion" not in {"id": "x", "title": "y"}


def test_stamp_overwrites_existing_version():
    out = sm.stamp({"_schemaVersion": 0, "id": "x"})
    assert out["_schemaVersion"] == sm.CURRENT_VERSION


def test_migrate_idempotent_at_current_version():
    row = {"_schemaVersion": sm.CURRENT_VERSION, "id": "x"}
    out = sm.migrate(row)
    assert out["_schemaVersion"] == sm.CURRENT_VERSION
    assert out["id"] == "x"


def test_migrate_treats_missing_version_as_v1():
    """Historical rows pre-dating the framework are structurally v1."""
    row = {"id": "old", "title": "legacy"}
    out = sm.migrate(row)
    # No actual migration happens (v1 is current); stamp only.
    assert out["_schemaVersion"] == sm.CURRENT_VERSION
    assert out["id"] == "old"


def test_migrate_corpus_no_migrations_no_changes():
    rows = [
        {"_schemaVersion": sm.CURRENT_VERSION, "id": str(i)} for i in range(5)
    ]
    out, changed = sm.migrate_corpus(rows)
    assert len(out) == 5
    assert changed == 0


def test_migrate_corpus_stamps_unstamped():
    rows = [{"id": "a"}, {"id": "b"}]
    out, changed = sm.migrate_corpus(rows)
    assert all(r["_schemaVersion"] == sm.CURRENT_VERSION for r in out)
    # Both rows changed (added the field)
    assert changed == 2


def test_walks_forward_through_chain(monkeypatch):
    """Synthetic test of a 2-step migration chain. Pins the iteration
    semantics so adding a real migration doesn't accidentally skip."""

    def v1_to_v2(row):
        out = dict(row)
        out["added_at_v2"] = True
        return out

    def v2_to_v3(row):
        out = dict(row)
        out["added_at_v3"] = True
        return out

    monkeypatch.setattr(sm, "CURRENT_VERSION", 3)
    monkeypatch.setattr(sm, "MIGRATIONS", [v1_to_v2, v2_to_v3])

    out = sm.migrate({"_schemaVersion": 1, "id": "x"})
    assert out["_schemaVersion"] == 3
    assert out["added_at_v2"] is True
    assert out["added_at_v3"] is True

    # Starting from v2 only runs v2→v3
    out = sm.migrate({"_schemaVersion": 2, "id": "x"})
    assert out["_schemaVersion"] == 3
    assert "added_at_v2" not in out
    assert out["added_at_v3"] is True
