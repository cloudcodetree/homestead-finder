"""Prompt templates for AI-powered scraping tasks."""

from __future__ import annotations

EXTRACT_LISTINGS_PROMPT = """\
Extract all land/property listings from this page content.

For each listing, return a JSON object with these exact fields:
- "title": listing title (string)
- "price": price in USD as a number (0 if not found)
- "acreage": acreage as a number (0 if not found)
- "state": two-letter state code (default: "{state}")
- "county": county name if visible, else ""
- "url": full listing URL if visible, else ""
- "description": brief description, max 500 chars
- "external_id": any unique ID from the source, else ""

Return ONLY a valid JSON array of objects. No explanation, no markdown fences.
If no listings are found, return an empty array: []

Source website: {source_name}
Target state: {state}
"""

DISCOVER_SELECTORS_PROMPT = """\
You are analyzing HTML from {source_name} ({url}) to find CSS selectors for property listing data.

The page contains land/property listings. I need CSS selectors to extract:
1. The container element for each listing card
2. The title text
3. The price text
4. The acreage text
5. The link/URL to the listing detail page
6. The location text (state, county)

{previous_selectors_note}

Analyze the HTML structure and return a JSON object with:
{{
  "selectors": {{
    "listing_container": "CSS selector for each listing card",
    "title": "CSS selector for title within a card",
    "price": "CSS selector for price within a card",
    "acreage": "CSS selector for acreage within a card",
    "link": "CSS selector for the detail link (with href)",
    "location": "CSS selector for location text"
  }},
  "field_extraction": {{
    "price_regex": "regex to extract numeric price from text",
    "acreage_regex": "regex to extract acreage number from text",
    "id_from_url_regex": "regex to extract listing ID from URL"
  }},
  "confidence": 0.0 to 1.0,
  "sample_listings": [
    first 3 listings extracted using your selectors
  ]
}}

Return ONLY valid JSON. No explanation, no markdown fences.
"""


def build_extraction_prompt(source_name: str, state: str) -> str:
    """Build a prompt for extracting listings from page content."""
    return EXTRACT_LISTINGS_PROMPT.format(source_name=source_name, state=state)


def build_selector_discovery_prompt(
    source_name: str,
    url: str,
    previous_selectors: dict | None = None,
) -> str:
    """Build a prompt for discovering CSS selectors from HTML."""
    if previous_selectors:
        note = f"Previous selectors that no longer work: {previous_selectors}"
    else:
        note = "No previous selectors available — discovering from scratch."

    return DISCOVER_SELECTORS_PROMPT.format(
        source_name=source_name,
        url=url,
        previous_selectors_note=note,
    )
