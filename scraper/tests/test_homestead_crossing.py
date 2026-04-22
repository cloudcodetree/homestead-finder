"""Tests for the Homestead Crossing parsers.

Both the HTML parser (used with Playwright-rendered content) and the
legacy markdown parser (Firecrawl) have coverage so neither silently
regresses while the other is the active code path.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sources.homestead_crossing import (
    parse_homestead_crossing_html,
    parse_homestead_crossing_markdown,
)


# Minimal HTML fragment mirroring the Rent Manager `.rmwb_listing-wrapper`
# structure captured from a live fetch 2026-04-22.
SAMPLE_HTML = """
<html><body>
  <div class="rmwb_listing-wrapper" data-acreage="4.5" data-status="Sold">
    <div class="rmwb_main-header"><h2>Ruby Ridge East B</h2><h3>County: Oregon</h3></div>
    <a href="/detail/?uid=1135">link</a>
    <ul>
      <li><span class="rmwb_info-title">Purchase Price</span><span class="rmwb_info-detail">$39,900.00</span></li>
      <li><span class="rmwb_info-title">State</span><span class="rmwb_info-detail">Missouri</span></li>
    </ul>
  </div>
  <div class="rmwb_listing-wrapper" data-acreage="10" data-status="Available">
    <div class="rmwb_main-header"><h2>Wolf Creek Tract 1</h2><h3>County: Howell</h3></div>
    <a href="/detail/?uid=1001">link</a>
    <ul>
      <li><span class="rmwb_info-title">Purchase Price</span><span class="rmwb_info-detail">$38,500.00</span></li>
      <li><span class="rmwb_info-title">State</span><span class="rmwb_info-detail">MO</span></li>
    </ul>
  </div>
  <div class="rmwb_listing-wrapper" data-acreage="8" data-status="Available">
    <div class="rmwb_main-header"><h2>Ozark Retreat</h2><h3>County: Carroll</h3></div>
    <a href="/detail/?uid=2001">link</a>
    <ul>
      <li><span class="rmwb_info-title">Purchase Price</span><span class="rmwb_info-detail">$45,000.00</span></li>
      <li><span class="rmwb_info-title">State</span><span class="rmwb_info-detail">Arkansas</span></li>
    </ul>
  </div>
</body></html>
"""


def test_html_parser_skips_sold_listings():
    items = parse_homestead_crossing_html(SAMPLE_HTML, default_state="MO")
    ids = {item["id"] for item in items}
    # Sold row (uid=1135) filtered out
    assert "1135" not in ids
    assert ids == {"1001", "2001"}


def test_html_parser_extracts_price_and_acreage():
    items = parse_homestead_crossing_html(SAMPLE_HTML, default_state="MO")
    by_id = {item["id"]: item for item in items}
    assert by_id["1001"]["price"] == 38500
    assert by_id["1001"]["acres"] == 10.0
    assert by_id["2001"]["price"] == 45000
    assert by_id["2001"]["acres"] == 8.0


def test_html_parser_extracts_county_and_state():
    items = parse_homestead_crossing_html(SAMPLE_HTML, default_state="MO")
    by_id = {item["id"]: item for item in items}
    assert by_id["1001"]["state"] == "MO"
    assert by_id["1001"]["county"] == "Howell County"
    assert by_id["2001"]["state"] == "AR"
    assert by_id["2001"]["county"] == "Carroll County"


def test_html_parser_returns_empty_on_empty_input():
    assert parse_homestead_crossing_html("", default_state="MO") == []


def test_html_parser_handles_missing_data_attributes_gracefully():
    html = """<div class="rmwb_listing-wrapper">
      <a href="/detail/?uid=999">link</a>
    </div>"""
    # No acreage, no price → filtered out rather than crash
    assert parse_homestead_crossing_html(html, default_state="MO") == []


# Realistic fragment mirroring what Firecrawl returns for the MO page:
# each listing card is a cluster of repeated links to /detail/?uid=N
# surrounded by plain-text price/acreage/location.
SAMPLE_MO_MARKDOWN = """
# Missouri Owner Financed Land

## Wolf Creek Tract 1
[Wolf Creek Tract 1](https://homesteadcrossing.com/detail/?uid=1001)

10.2 acres in Howell County, MO. Year-round creek on the western
boundary. $38,500. Owner financed.
[View Details](https://homesteadcrossing.com/detail/?uid=1001)

---

## Van Buren Homestead
[Van Buren Homestead](https://homesteadcrossing.com/detail/?uid=1045)

40 acres. Texas County, Missouri. Power at road, well site ready.
$89,900 with seller financing.
[View](https://homesteadcrossing.com/detail/?uid=1045)

---

## Shelton Road 5
[Shelton Road 5](https://homesteadcrossing.com/detail/?uid=1067)

5.0 ac · $24,900 · Douglas County, MO
Off-grid ready. Owner carry available.
[View](https://homesteadcrossing.com/detail/?uid=1067)
"""


SAMPLE_AR_MARKDOWN = """
# Arkansas Owner Financed Land

## Ozark Retreat
[Ozark Retreat](https://homesteadcrossing.com/detail/?uid=2001)

8 acres, Carroll County, AR. $45,000 owner finance.
[View](https://homesteadcrossing.com/detail/?uid=2001)
"""


def test_parse_extracts_three_distinct_listings_from_mo_page():
    items = parse_homestead_crossing_markdown(SAMPLE_MO_MARKDOWN, default_state="MO")
    assert len(items) == 3
    ids = {item["id"] for item in items}
    assert ids == {"1001", "1045", "1067"}


def test_parse_captures_price_and_acreage():
    items = parse_homestead_crossing_markdown(SAMPLE_MO_MARKDOWN, default_state="MO")
    by_id = {item["id"]: item for item in items}
    assert by_id["1001"]["price"] == 38500
    assert by_id["1001"]["acres"] == 10.2
    assert by_id["1045"]["price"] == 89900
    assert by_id["1045"]["acres"] == 40.0
    assert by_id["1067"]["price"] == 24900
    assert by_id["1067"]["acres"] == 5.0


def test_parse_picks_descriptive_title_over_view_label():
    items = parse_homestead_crossing_markdown(SAMPLE_MO_MARKDOWN, default_state="MO")
    by_id = {item["id"]: item for item in items}
    # "View" / "View Details" labels must not clobber the real title
    assert by_id["1001"]["title"] == "Wolf Creek Tract 1"
    assert by_id["1045"]["title"] == "Van Buren Homestead"


def test_parse_captures_county_and_state_from_card_body():
    items = parse_homestead_crossing_markdown(SAMPLE_MO_MARKDOWN, default_state="MO")
    by_id = {item["id"]: item for item in items}
    assert by_id["1001"]["county"] == "Howell County"
    assert by_id["1001"]["state"] == "MO"
    assert by_id["1045"]["county"] == "Texas County"
    assert by_id["1067"]["county"] == "Douglas County"


def test_parse_handles_arkansas_state_page():
    items = parse_homestead_crossing_markdown(SAMPLE_AR_MARKDOWN, default_state="AR")
    assert len(items) == 1
    assert items[0]["state"] == "AR"
    assert items[0]["county"] == "Carroll County"


def test_parse_returns_empty_on_empty_input():
    assert parse_homestead_crossing_markdown("", default_state="MO") == []
    assert (
        parse_homestead_crossing_markdown("nothing relevant here", default_state="MO")
        == []
    )


def test_parse_skips_card_without_price_or_acres():
    # Listing link present but no price/acreage anywhere nearby → dropped
    markdown = (
        "## Incomplete listing\n"
        "[A parcel](https://homesteadcrossing.com/detail/?uid=9999)\n"
        "No numerical data.\n"
    )
    assert parse_homestead_crossing_markdown(markdown, default_state="MO") == []


def test_parse_dedupes_repeated_uids_in_same_cluster():
    # Cards repeat the same /detail/?uid=N link 3+ times (image, title,
    # "View") — we should only return one row per uid.
    items = parse_homestead_crossing_markdown(SAMPLE_MO_MARKDOWN, default_state="MO")
    assert len({item["id"] for item in items}) == len(items)
