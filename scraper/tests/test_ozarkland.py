"""Tests for the OzarkLand markdown parser."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sources.ozarkland import parse_ozarkland_markdown


SAMPLE_MARKDOWN = """
# Land For Sale In The Ozarks

## Featured Properties

### Jones Point Parcel E
[Jones Point Parcel E](https://ozarkland.com/property/jones-point-parcel-e/)

5.0 acres in Stone County, Missouri.
$38,900 — 100% owner financing. No credit check.
[View](https://ozarkland.com/property/jones-point-parcel-e/)

---

### Bear Hollow Tract
[Bear Hollow Tract](https://ozarkland.com/property/bear-hollow-tract/)

6 acres, Carroll County, Arkansas
$48,500. No down payment required.
[View](https://ozarkland.com/property/bear-hollow-tract/)

---

### Eagle Point 3
[Eagle Point 3](https://ozarkland.com/property/eagle-point-3/)

3 ac · $34,900 · Ozark MO

Sold: (SOLD)
"""


def test_parse_extracts_three_listings():
    items = parse_ozarkland_markdown(SAMPLE_MARKDOWN)
    assert len(items) == 3
    slugs = {item["id"] for item in items}
    assert slugs == {"jones-point-parcel-e", "bear-hollow-tract", "eagle-point-3"}


def test_parse_captures_price_and_acres():
    items = parse_ozarkland_markdown(SAMPLE_MARKDOWN)
    by_id = {item["id"]: item for item in items}
    assert by_id["jones-point-parcel-e"]["price"] == 38900
    assert by_id["jones-point-parcel-e"]["acres"] == 5.0
    assert by_id["bear-hollow-tract"]["price"] == 48500
    assert by_id["bear-hollow-tract"]["acres"] == 6.0


def test_parse_detects_state_from_text():
    items = parse_ozarkland_markdown(SAMPLE_MARKDOWN)
    by_id = {item["id"]: item for item in items}
    assert by_id["jones-point-parcel-e"]["state"] == "MO"
    assert by_id["bear-hollow-tract"]["state"] == "AR"


def test_parse_detects_county_when_mentioned():
    items = parse_ozarkland_markdown(SAMPLE_MARKDOWN)
    by_id = {item["id"]: item for item in items}
    assert by_id["jones-point-parcel-e"]["county"] == "Stone County"
    assert by_id["bear-hollow-tract"]["county"] == "Carroll County"


def test_parse_falls_back_to_mo_when_state_ambiguous():
    # "Eagle Point 3" card just says "Ozark MO" which the regex catches.
    # A truly ambiguous one should fall through to MO (documented default).
    md = (
        "### Mystery Parcel\n"
        "[Mystery Parcel](https://ozarkland.com/property/mystery-parcel/)\n"
        "10 acres, $50,000. Somewhere pretty.\n"
    )
    items = parse_ozarkland_markdown(md)
    assert len(items) == 1
    assert items[0]["state"] == "MO"


def test_parse_returns_empty_on_empty_input():
    assert parse_ozarkland_markdown("") == []


def test_parse_dedupes_repeated_slug_links():
    items = parse_ozarkland_markdown(SAMPLE_MARKDOWN)
    assert len({item["id"] for item in items}) == len(items)


def test_parse_skips_listings_missing_price_or_acres():
    md = (
        "### No numbers\n"
        "[No numbers](https://ozarkland.com/property/nothing/)\n"
        "Just vibes.\n"
    )
    assert parse_ozarkland_markdown(md) == []
