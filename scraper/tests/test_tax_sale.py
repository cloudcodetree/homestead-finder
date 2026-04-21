"""Tests for the county tax-sale registry, parsers, and scraper mapping.

Uses a fixture PDF captured from Park County WY's 2024 tax-sale list
so no network/Firecrawl calls happen during tests.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from sources.county_tax import CountyTaxScraper
from sources.tax_sale_parser import PARSERS, get_parser
from sources.tax_sale_registry import (
    TaxSaleSource,
    all_sources,
    sources_for_state,
)

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "wy_park_tax_sale_2024.pdf"


# ── registry ─────────────────────────────────────────────────────────────


def test_registry_has_wyoming_counties():
    wy = sources_for_state("WY")
    counties = {s.county for s in wy}
    assert "Park" in counties
    assert "Natrona" in counties


def test_registry_is_case_insensitive():
    assert sources_for_state("wy") == sources_for_state("WY")


def test_registry_returns_empty_for_unknown_state():
    assert sources_for_state("XX") == []


def test_all_sources_matches_per_state_sum():
    by_state = {s.state for s in all_sources()}
    total = sum(len(sources_for_state(st)) for st in by_state)
    assert len(all_sources()) == total


def test_every_registered_parser_exists():
    """Every parser name in the registry must resolve to a function in PARSERS."""
    for source in all_sources():
        assert get_parser(source.parser) is not None, (
            f"parser {source.parser!r} referenced by {source.county} "
            f"{source.state} is not registered"
        )


# ── wy_semicolon_pdf parser ──────────────────────────────────────────────


def test_wy_parser_extracts_records_from_real_pdf():
    parser = get_parser("wy_semicolon_pdf")
    records = parser(FIXTURE_PDF.read_bytes())
    # Park County's 2024 list has ~278 delinquent parcels
    assert 200 < len(records) < 400


def test_wy_parser_record_shape_is_complete():
    parser = get_parser("wy_semicolon_pdf")
    records = parser(FIXTURE_PDF.read_bytes())
    for rec in records[:25]:  # spot-check first 25
        assert rec["parcelId"]
        assert rec["amountOwedUsd"] > 0
        assert rec["taxYear"] > 2000
        assert rec["propertyType"] in ("RE", "IR")  # Park uses these codes


def test_wy_parser_strips_preamble_text_from_owner():
    """The first record in the raw PDF carries the legal preamble. The
    parser must not leak preamble text into any owner name."""
    parser = get_parser("wy_semicolon_pdf")
    records = parser(FIXTURE_PDF.read_bytes())
    preamble_markers = ("AFORESAID", "HEREBY GIVEN", "NOTICE IS", "TO WIT:")
    leaks = [
        r for r in records if any(m in r["owner"].upper() for m in preamble_markers)
    ]
    assert not leaks, f"preamble leaked into {len(leaks)} owner fields"


def test_wy_parser_amounts_are_positive_floats():
    parser = get_parser("wy_semicolon_pdf")
    records = parser(FIXTURE_PDF.read_bytes())
    assert all(isinstance(r["amountOwedUsd"], float) for r in records)
    assert all(r["amountOwedUsd"] > 0 for r in records)


def test_wy_parser_returns_empty_on_garbage_bytes():
    parser = get_parser("wy_semicolon_pdf")
    # A truncated/non-PDF input should not raise
    assert parser(b"not a pdf") == []


def test_ocr_placeholder_returns_empty():
    parser = get_parser("ocr_placeholder")
    assert parser(b"anything") == []


# ── CountyTaxScraper integration ─────────────────────────────────────────


@pytest.fixture
def scraper():
    return CountyTaxScraper(config={})


def _fake_pdf_download_factory(pdf_path: Path):
    """Patch `_download_pdf` so tests don't hit the network. Returns the
    fixture bytes for any URL."""

    def _fake(self, url: str) -> bytes:  # noqa: ARG001
        return pdf_path.read_bytes()

    return _fake


def test_scraper_returns_records_stamped_with_county_and_state(scraper):
    with patch.object(
        CountyTaxScraper, "_download_pdf", _fake_pdf_download_factory(FIXTURE_PDF)
    ):
        records = scraper.fetch("WY")
    # Park returns the fixture; Natrona uses ocr_placeholder and yields 0
    assert any(r["county"] == "Park" for r in records)
    assert all(r["state"] == "WY" for r in records)
    assert all("saleMonth" in r and "stateType" in r for r in records)


def test_scraper_parse_produces_valid_raw_listing(scraper):
    with patch.object(
        CountyTaxScraper, "_download_pdf", _fake_pdf_download_factory(FIXTURE_PDF)
    ):
        records = scraper.fetch("WY")
    raw = scraper.parse(records[0])
    assert raw is not None
    assert raw.state == "WY"
    assert raw.county == "Park"
    assert raw.price > 0
    assert raw.external_id.startswith("wy_park_")
    assert "tax sale" in raw.title.lower()


def test_scraper_to_property_marks_status_and_attaches_taxSale(scraper):
    with patch.object(
        CountyTaxScraper, "_download_pdf", _fake_pdf_download_factory(FIXTURE_PDF)
    ):
        records = scraper.fetch("WY")
    raw = scraper.parse(records[0])
    prop = scraper.to_property(raw)
    assert prop["status"] == "tax_sale"
    ts = prop["taxSale"]
    assert ts["parcelId"]
    assert ts["amountOwedUsd"] > 0
    assert ts["stateType"] == "lien"
    assert ts["saleMonth"] == 8  # Park sale is August per registry
    assert ts["listUrl"].startswith("https://")


def test_scraper_rejects_records_with_zero_amount(scraper):
    # Amount=0 should fail RawListing validation
    bad = {
        "owner": "X",
        "parcelId": "R1",
        "amountOwedUsd": 0,
        "county": "Park",
        "state": "WY",
    }
    assert scraper.parse(bad) is None


def test_scraper_rejects_records_with_empty_parcel(scraper):
    bad = {
        "owner": "X",
        "parcelId": "",
        "amountOwedUsd": 100,
        "county": "Park",
        "state": "WY",
    }
    assert scraper.parse(bad) is None


def test_scraper_handles_unknown_parser_gracefully():
    """If the registry points at a non-existent parser, the scraper must
    log and return [] rather than crash."""
    bogus = TaxSaleSource(
        county="Fake",
        state="WY",
        listUrl="https://example.com/fake.pdf",
        listFormat="pdf",
        parser="does_not_exist",
        saleMonth=None,
        stateType="lien",
    )
    scraper = CountyTaxScraper(config={})
    assert scraper._fetch_source(bogus) == []


def test_scraper_skips_unsupported_list_formats():
    unsupported = TaxSaleSource(
        county="Fake",
        state="WY",
        listUrl="https://example.com/",
        listFormat="bid4assets",  # not yet implemented
        parser="wy_semicolon_pdf",
        saleMonth=None,
        stateType="deed",
    )
    scraper = CountyTaxScraper(config={})
    assert scraper._fetch_source(unsupported) == []


# ── parser-registry contract ─────────────────────────────────────────────


def test_parsers_registry_covers_all_referenced_parsers():
    """Every parser name used in the registry must exist in PARSERS — this
    is what `test_every_registered_parser_exists` asserts more loosely,
    but enforcing PARSERS-as-whitelist is the mirror check."""
    referenced = {s.parser for s in all_sources()}
    known = set(PARSERS.keys())
    assert referenced <= known
