"""Tests for project_files_extract.py — format dispatch + extraction.

Network calls (Supabase + Storage) are not exercised. Tests focus on
the pure extraction functions which is where bugs hide.
"""

from __future__ import annotations

import io

import pytest

import project_files_extract as ex


def test_extract_text_dispatches_by_extension():
    assert "hello world" in ex.extract(b"hello world", "text/plain", "x.txt")
    assert "hello world" in ex.extract(b"hello world", None, "notes.md")
    assert "a,b,c" in ex.extract(b"a,b,c\n1,2,3\n", None, "data.csv")


def test_extract_text_dispatches_by_content_type():
    """Trust content_type when extension is missing/wrong."""
    assert "hello" in ex.extract(b"hello", "text/markdown", "noext")


def test_extract_returns_empty_for_unsupported():
    """Images aren't supported in v1 — return '' so extracted_text
    stays NULL and a future Claude Vision pass can pick it up."""
    assert ex.extract(b"\x89PNG\r\n", "image/png", "photo.png") == ""
    assert ex.extract(b"binary", "application/zip", "archive.zip") == ""


def test_extract_text_handles_invalid_utf8_gracefully():
    """Surrogate-escape means we don't lose data on weird encodings."""
    bad = b"hello\xff\xfeworld"
    out = ex.extract(bad, "text/plain", "x.txt")
    assert "hello" in out and "world" in out


def test_extract_pdf_handles_missing_dep(monkeypatch):
    """If pdfplumber import fails, we return '' and log — no crash."""
    import builtins
    real = builtins.__import__

    def fake(name, *a, **kw):
        if name == "pdfplumber":
            raise ImportError("simulated")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    assert ex._extract_pdf(b"%PDF-1.4 fake") == ""


def test_extract_xlsx_handles_missing_dep(monkeypatch):
    import builtins
    real = builtins.__import__

    def fake(name, *a, **kw):
        if name == "openpyxl":
            raise ImportError("simulated")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    assert ex._extract_xlsx(b"PK\x03\x04 fake") == ""


def test_extract_docx_handles_missing_dep(monkeypatch):
    import builtins
    real = builtins.__import__

    def fake(name, *a, **kw):
        if name == "docx":
            raise ImportError("simulated")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    assert ex._extract_docx(b"PK\x03\x04 fake") == ""


def test_extract_pdf_handles_corrupt_input():
    """pdfplumber raises on garbage — we catch and return ''."""
    out = ex._extract_pdf(b"not a real pdf")
    assert out == ""


def test_extract_xlsx_real_workbook():
    """Quick smoke test against an actual openpyxl-generated workbook
    so we know the extractor produces non-empty output for valid input."""
    pytest.importorskip("openpyxl")
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "MyData"
    ws.append(["Name", "Value"])
    ws.append(["alpha", 1])
    ws.append(["beta", 2])
    buf = io.BytesIO()
    wb.save(buf)
    out = ex._extract_xlsx(buf.getvalue())
    assert "## MyData" in out
    assert "Name,Value" in out
    assert "alpha,1" in out
    assert "beta,2" in out


def test_max_text_bytes_constant_sane():
    """Pin the truncation cap so it doesn't accidentally get bumped to
    a value that overflows Postgres text (no hard limit) or floods the
    AI context (~50K tokens at 4 chars/token)."""
    assert ex.MAX_TEXT_BYTES == 200_000
