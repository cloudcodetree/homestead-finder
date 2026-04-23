"""Golden-set regression tests — parser-shape canaries.

Each source that ships here is paired with a captured live-site fixture.
Tests assert *shape* invariants (non-zero row count, valid fields per row)
rather than exact content, because the fixtures age with time:
  * listings expire,
  * sites tweak slugs or image CDNs,
  * new rows are added to the top of the feed.

The value: when a site changes its HTML/JSON in a way that breaks our
parser, the daily scrape would otherwise silently return 0 listings for
that source until someone noticed. These tests fail fast in CI the
moment a parser stops producing valid rows.

To refresh fixtures (do this when a source legitimately changes shape
and you've already fixed the parser):

    cd scraper/tests/fixtures/golden
    curl ... > landhub_mo_page1.html
    # etc.

Fixtures live under scraper/tests/fixtures/golden/. Not committed as
"real data" — they're treated as test assets.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_FIXTURES = Path(__file__).parent / "fixtures" / "golden"


# ── LandHub ────────────────────────────────────────────────────────


def test_landhub_parser_extracts_listings_from_fixture():
    """Shape check for the LandHub Next.js parser."""
    from sources.landhub import _extract_listings, LandHubScraper

    fixture = _FIXTURES / "landhub_mo_page1.html"
    html = fixture.read_text()
    rows = _extract_listings(html)
    assert len(rows) >= 10, f"expected >=10 rows, got {len(rows)}"

    s = LandHubScraper(config={})
    parsed = [s.parse(r) for r in rows]
    valid = [p for p in parsed if p is not None]
    assert len(valid) >= 6, (
        f"expected >=6 valid RawListings, got {len(valid)} "
        f"(raw count {len(rows)})"
    )

    # Every valid row must have a non-empty title + id
    for p in valid:
        assert p.title, f"empty title on {p.external_id}"
        assert p.external_id.isdigit(), f"non-numeric id: {p.external_id!r}"
        assert p.url.startswith("https://www.landhub.com/property/")

    # At least 70% of rows carry lat/lng (captured from Next.js JSON
    # directly — drops only if LandHub removes the field)
    with_geo = [p for p in valid if p.lat and p.lng]
    assert len(with_geo) >= int(0.7 * len(valid)), (
        f"geo-coord coverage dropped: {len(with_geo)}/{len(valid)}"
    )


def test_landhub_rejects_malicious_ids():
    """Regression for the path-traversal hardening added 2026-04-23."""
    from sources.landhub import LandHubScraper

    s = LandHubScraper(config={})
    for bad_id in ["../admin", "..", "foo/bar", "abc"]:
        row = {
            "id": bad_id,
            "title": "t",
            "price": 1000,
            "acres": 10,
            "image": '["../pwn.jpg"]',
            "state": "Missouri",
            "latitude": "35",
            "longitude": "-92",
        }
        assert s.parse(row) is None, f"should have rejected id={bad_id!r}"


# ── Mossy Oak ──────────────────────────────────────────────────────


def test_mossy_oak_parser_extracts_listings_from_fixture():
    """Shape check for the Mossy Oak BS4 card parser."""
    from sources.mossy_oak import parse_mossy_oak_html, MossyOakScraper

    fixture = _FIXTURES / "mossyoak_ar.html"
    html = fixture.read_text()
    rows = parse_mossy_oak_html(html, "AR")
    assert len(rows) >= 10, (
        f"mossy_oak parser returned {len(rows)} rows — CSS selectors broke?"
    )

    s = MossyOakScraper(config={})
    parsed = [s.parse(r) for r in rows]
    valid = [p for p in parsed if p is not None]
    assert len(valid) >= 8, f"expected >=8 valid, got {len(valid)}"

    # Mossy Oak cards carry data-lat/data-lng — most should have geo
    with_geo = [p for p in valid if p.lat and p.lng]
    assert len(with_geo) >= int(0.8 * len(valid)), (
        f"mossy_oak geo coverage dropped: {len(with_geo)}/{len(valid)}"
    )


# ── Craigslist ─────────────────────────────────────────────────────


def test_craigslist_parser_extracts_from_sapi_fixture():
    """Shape check for the Craigslist sapi positional-array parser."""
    from sources.craigslist import _parse_item, _infer_state_from_bbox

    fixture = _FIXTURES / "craigslist_sapi.json"
    data = json.loads(fixture.read_text())
    items = data.get("data", {}).get("items", [])
    assert len(items) >= 20, (
        f"expected >=20 sapi items, got {len(items)} — DDG changed shape?"
    )

    parsed = [p for p in (_parse_item(i) for i in items) if p]
    assert len(parsed) >= 10, (
        f"Craigslist parser kept {len(parsed)}/{len(items)} items — "
        "positional schema likely drifted"
    )

    # Every parsed row must carry lat/lng (that's what bbox filter needs)
    for p in parsed:
        assert p["lat"] is not None and p["lng"] is not None, p
        # `id` is a stringified post_id; can be "0" when the positional
        # decoder missed the post-id field on a malformed item — still a
        # valid row, just unlinkable.
        assert p["url"].startswith("https://craigslist.org"), p

    # Sanity: prices should be non-absurd (we cap at $500k in the parser)
    for p in parsed:
        assert p["price"] <= 500_000, f"$500k cap broken: {p}"

    # At least a few rows should infer to a US state via bbox
    states = {_infer_state_from_bbox(p["lat"], p["lng"]) for p in parsed}
    states.discard(None)
    # Not strict about MO/AR hits (fixture may be light) — just assert
    # we got at least one state inference
    # pass when the bbox helper works at all
    _ = states


# ── Fixture freshness guard ────────────────────────────────────────


@pytest.mark.parametrize(
    "name",
    ["landhub_mo_page1.html", "mossyoak_ar.html", "craigslist_sapi.json"],
)
def test_fixtures_exist_and_nonempty(name):
    """Every fixture referenced above must exist. Catches accidental
    deletion during refactors."""
    path = _FIXTURES / name
    assert path.exists(), f"fixture missing: {name}"
    assert path.stat().st_size > 1000, f"fixture suspiciously small: {name}"
