"""Tests for LandWatch markdown parser (Firecrawl output path)."""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure scraper root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sources.landwatch import (
    STATE_SLUGS,
    LandWatchScraper,
    parse_markdown_listings,
)


FIXTURE = Path(__file__).parent / "fixtures" / "landwatch_mt_page1.md"


def test_parse_markdown_extracts_all_listings_from_real_page() -> None:
    """Against a real Firecrawl capture of Montana page 1, we expect 25 listings."""
    md = FIXTURE.read_text()
    listings = parse_markdown_listings(md, "MT")

    assert len(listings) == 25, f"expected 25 listings, got {len(listings)}"


def test_parse_markdown_populates_all_core_fields() -> None:
    """Every parsed listing must have the fields needed by parse() to build a RawListing."""
    md = FIXTURE.read_text()
    listings = parse_markdown_listings(md, "MT")

    for listing in listings:
        assert listing["id"], f"missing id: {listing}"
        assert listing["title"], f"missing title: {listing}"
        assert listing["price"] > 0, f"bad price: {listing}"
        assert listing["acres"] > 0, f"bad acres: {listing}"
        assert listing["state"] == "MT"
        assert listing["county"], f"missing county: {listing}"
        assert listing["url"].startswith("https://www.landwatch.com/")
        assert "/pid/" in listing["url"]


def test_parse_markdown_parses_price_and_acres_correctly() -> None:
    """Check a known listing with a distinctive price/acreage."""
    md = FIXTURE.read_text()
    listings = parse_markdown_listings(md, "MT")
    by_id = {item["id"]: item for item in listings}

    # "Beartooth Creek Legacy" — $4,200,000, 122 acres, Carbon County
    assert "426385876" in by_id
    beartooth = by_id["426385876"]
    assert beartooth["price"] == 4_200_000.0
    assert beartooth["acres"] == 122.0
    assert beartooth["county"] == "Carbon County"

    # "Windancer Ranch" — $28,330,000, 14,160 acres (tests comma-separated acres)
    assert "422992565" in by_id
    windancer = by_id["422992565"]
    assert windancer["price"] == 28_330_000.0
    assert windancer["acres"] == 14_160.0


def test_parse_markdown_returns_empty_for_non_listing_page() -> None:
    """A 404/error page should yield zero listings, not crash."""
    md = "# Oops!\n\nWe couldn't find this page\n\n[Go to homepage](https://www.landwatch.com/)"
    assert parse_markdown_listings(md, "MT") == []


def test_parse_markdown_handles_listings_without_beds_baths() -> None:
    """Raw land listings lack a 'X beds • Y baths' line but should still parse."""
    md = FIXTURE.read_text()
    listings = parse_markdown_listings(md, "MT")
    # Our fixture has a known no-beds listing at PID 420912348 (Last Best Line Creek Ranch)
    by_id = {item["id"]: item for item in listings}
    assert "420912348" in by_id
    assert by_id["420912348"]["acres"] == 872.0


def test_state_url_uses_correct_slug() -> None:
    scraper = LandWatchScraper(config={})
    assert (
        scraper._state_url("MT", 1) == "https://www.landwatch.com/montana-land-for-sale"
    )
    assert (
        scraper._state_url("MT", 2)
        == "https://www.landwatch.com/montana-land-for-sale/page-2"
    )
    assert (
        scraper._state_url("NM", 3)
        == "https://www.landwatch.com/new-mexico-land-for-sale/page-3"
    )


def test_state_url_returns_empty_for_unknown_state() -> None:
    scraper = LandWatchScraper(config={})
    assert scraper._state_url("XX", 1) == ""


def test_state_slugs_cover_target_states() -> None:
    """The states in the production config must all be resolvable."""
    for st in ["MT", "ID", "WY", "CO", "NM", "OR", "WA", "TX", "TN", "MN", "ME"]:
        assert st in STATE_SLUGS, f"missing slug for {st}"


def test_get_page_urls_respects_max_pages() -> None:
    scraper = LandWatchScraper(config={})
    urls = scraper.get_page_urls("MT", max_pages=3)
    assert len(urls) == 3
    assert urls[0].endswith("montana-land-for-sale")
    assert urls[1].endswith("page-2")
    assert urls[2].endswith("page-3")


def test_parse_markdown_handles_page2_without_title_links() -> None:
    """Pages 2+ of LandWatch often omit the title link entirely, leaving
    only the price/address/description links. We must fall back to an
    address-derived locality instead of writing 'Listing Details Page'
    (a literal link label LandWatch uses for 'see more') or the generic
    'Land in <STATE>' placeholder."""
    p2_fixture = Path(__file__).parent / "fixtures" / "landwatch_mt_page2.md"
    listings = parse_markdown_listings(p2_fixture.read_text(), "MT")
    assert len(listings) > 0

    # No listing should have "Listing Details Page" as its title — that's
    # the LandWatch UI link, not a property name.
    for listing in listings:
        assert "Listing Details Page" not in listing["title"], (
            f"leaked UI label into title: {listing}"
        )

    # At least some listings must fall back to the locality-based title
    # (of the form "<Street or City>, MT"). The presence of this pattern
    # confirms the fallback chain fires correctly on title-less clusters.
    locality_fallbacks = [
        listing for listing in listings if listing["title"].endswith(", MT")
    ]
    assert len(locality_fallbacks) > 0, (
        "expected at least one locality-based title fallback on page 2"
    )


def test_parse_full_listing_builds_raw_listing() -> None:
    """End-to-end: markdown → dict → RawListing via scraper.parse()."""
    md = FIXTURE.read_text()
    listings = parse_markdown_listings(md, "MT")
    scraper = LandWatchScraper(config={})

    raw = scraper.parse(listings[0])
    assert raw is not None
    assert raw.price > 0
    assert raw.acreage > 0
    assert raw.state == "MT"
    assert raw.county
    assert raw.external_id
    assert raw.url.startswith("https://www.landwatch.com/")
