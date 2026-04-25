"""Tests for raw_archive.py — gzipped raw-response preservation.

The archive is best-effort (never raises on disk failures) so tests
focus on success paths + safe fallbacks for pathological inputs.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import pytest

import raw_archive


@pytest.fixture(autouse=True)
def _isolated_raw_dir(tmp_path, monkeypatch):
    """Point RAW_DIR at a tmp_path so tests don't pollute data/raw/."""
    monkeypatch.setattr(raw_archive, "RAW_DIR", tmp_path / "raw")
    yield


def test_archive_writes_gzipped_payload():
    p = raw_archive.archive(
        "landwatch", "12345", "<html>hi</html>", ext="html"
    )
    assert p is not None
    assert p.exists()
    assert p.suffix == ".gz"
    # Content roundtrips
    with gzip.open(p, "rb") as f:
        assert f.read() == b"<html>hi</html>"


def test_archive_accepts_bytes():
    p = raw_archive.archive("craigslist", "abc", b"\x00\x01raw\x02", ext="json")
    assert p is not None
    with gzip.open(p, "rb") as f:
        assert f.read() == b"\x00\x01raw\x02"


def test_archive_rejects_invalid_ext():
    p = raw_archive.archive("landwatch", "12345", "x", ext="exe")
    assert p is None


def test_archive_rejects_empty_source():
    p = raw_archive.archive("", "12345", "x")
    assert p is None


def test_archive_sanitizes_pathological_listing_id():
    """A listing_id with path-traversal characters should NOT escape
    the raw/{source}/{date}/ subdirectory."""
    p = raw_archive.archive(
        "landwatch", "../../../etc/passwd", "evil", ext="txt"
    )
    assert p is not None
    # Resolve and confirm the path stays under RAW_DIR
    resolved = p.resolve()
    raw_root = raw_archive.RAW_DIR.resolve()
    assert str(resolved).startswith(str(raw_root))


def test_archive_uses_hash_when_id_is_pure_garbage():
    # All-special-char id collapses to empty after sanitization → hash
    p = raw_archive.archive("landwatch", "////////", "x")
    assert p is not None
    # filename should be a hex-ish hash, not empty
    name = p.name.split(".", 1)[0]
    assert len(name) >= 8
    assert all(c in "0123456789abcdef" for c in name)


def test_read_returns_decompressed():
    raw_archive.archive("mossy_oak", "999", "stored", ext="html")
    out = raw_archive.read("mossy_oak", "2026-01-01", "999")
    # Default day is today's date — read with that day instead.
    from datetime import date as date_cls

    today = date_cls.today().isoformat()
    out = raw_archive.read("mossy_oak", today, "999")
    assert out == b"stored"


def test_read_returns_none_for_missing():
    assert raw_archive.read("mossy_oak", "1999-01-01", "missing") is None


def test_list_archived_returns_ids():
    from datetime import date as date_cls

    raw_archive.archive("ozark", "100", "a")
    raw_archive.archive("ozark", "200", "b")
    today = date_cls.today().isoformat()
    ids = raw_archive.list_archived("ozark", today)
    assert sorted(ids) == ["100", "200"]
