"""LandWatch scraper — https://www.landwatch.com

Two fetch paths depending on strategy chain result:
- HTML (from requests/selenium): parse listing cards with BeautifulSoup
- Markdown (from Firecrawl): parse via regex on grouped /pid/<id> links
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from logger import get_logger
from strategies.base import AllStrategiesFailed
from utils.us_states import STATE_SLUGS, slug_for

from .base import BaseScraper, RawListing

log = get_logger("scraper.landwatch")


__all__ = [
    "LandWatchScraper",
    "STATE_SLUGS",  # re-exported for backward-compat with existing tests
    "parse_markdown_listings",
    "extract_features",
]


FEATURE_KEYWORDS: dict[str, list[str]] = {
    "water_well": ["water well", "drilled well", "domestic well"],
    "water_creek": ["creek", "stream", "river", "year-round water"],
    "water_pond": ["pond", "lake", "stock tank"],
    "road_paved": ["paved road", "paved access", "highway frontage"],
    "road_dirt": ["dirt road", "gravel road", "county road", "forest road"],
    "electric": ["electricity", "electric", "power to", "utilities"],
    "septic": ["septic", "leach field"],
    "structures": ["cabin", "house", "barn", "shop", "building"],
    "timber": ["timber", "pine", "fir", "hardwood", "forest"],
    "pasture": ["pasture", "meadow", "grassland", "hay"],
    "hunting": ["hunting", "elk", "deer", "turkey", "game"],
    "mineral_rights": ["mineral rights", "minerals included"],
    "no_hoa": ["no hoa", "no covenants", "no restrictions", "unrestricted"],
    "off_grid_ready": ["off-grid", "off grid", "solar", "self-sufficient"],
    "owner_financing": [
        "owner financing",
        "owner will carry",
        "seller financing",
        "land contract",
    ],
}


def extract_features(text: str) -> list[str]:
    """Extract feature tags from listing description/title."""
    text_lower = text.lower()
    features = []
    for feature, keywords in FEATURE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            features.append(feature)
    return features


# ─── Markdown parser (for Firecrawl output) ─────────────────────────────────

# Match [text](url) where url contains /pid/<numeric id>
_MD_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((https?://www\.landwatch\.com/[^)]*?/pid/(\d+))[^)]*\)"
)
_PRICE_ACRES_RE = re.compile(r"\$([\d,]+)\s*[•·]\s*([\d,.]+)\s*acres?", re.IGNORECASE)
_ADDRESS_RE = re.compile(
    r",\s*([A-Z]{2})\s*,\s*\d{5}\s*,\s*([\w\s.-]+?)\s*County", re.IGNORECASE
)
_BEDS_RE = re.compile(r"\d+\s*beds?\s*[•·]\s*\d+\s*baths?", re.IGNORECASE)

# Noise texts embedded in image-carousel link captions AND generic
# "click to continue" type labels LandWatch uses on pages 2+ instead of
# actual property titles ("Listing Details Page" — literally).
_NOISE_FRAGMENTS = (
    "Loading Results",
    "Land for sale in",
    "VIDEOMAP",
    "Listing Details Page",
)

# "123 Main St, Townname, ST, 12345, Foo County" — first piece before the
# comma is the best short label when a listing has no title link. Matches
# addresses beginning with either a street number+name or just a city.
_ADDRESS_LOCALITY_RE = re.compile(
    r"^([^,]+?),\s*(?:[^,]+,\s*)?[A-Z]{2}\s*,\s*\d{5}", re.IGNORECASE
)


def parse_markdown_listings(markdown: str, state: str) -> list[dict[str, Any]]:
    """Extract listing dicts from Firecrawl markdown.

    LandWatch renders each listing as a cluster of markdown links all pointing
    to the same /pid/<id> URL. Grouping by PID yields one cluster per listing;
    within the cluster the distinguishable texts are title, address, price/acres,
    beds/baths (optional), and description.
    """
    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for text, url, pid in _MD_LINK_RE.findall(markdown):
        stripped = text.strip()
        if any(frag in stripped for frag in _NOISE_FRAGMENTS):
            continue
        # Skip listings broken across image placeholders — keep only actual content
        groups[pid].append((stripped, url))

    results: list[dict[str, Any]] = []
    for pid, items in groups.items():
        listing = _extract_listing_from_cluster(pid, items, state)
        if listing is not None:
            results.append(listing)
    return results


def _extract_listing_from_cluster(
    pid: str, items: list[tuple[str, str]], state: str
) -> dict[str, Any] | None:
    """Turn one PID's link cluster into a listing dict."""
    url = items[0][1]

    # Dedup while preserving order
    seen: set[str] = set()
    texts: list[str] = []
    for text, _ in items:
        if text in seen or not text:
            continue
        seen.add(text)
        texts.append(text)

    title: str | None = None
    address: str | None = None
    price_acres: str | None = None
    description: str | None = None

    for t in texts:
        if _PRICE_ACRES_RE.search(t) and price_acres is None:
            price_acres = t
        elif _ADDRESS_RE.search(t) and address is None:
            address = t
        elif _BEDS_RE.search(t):
            # Skip beds/baths line — not useful for land scoring
            continue
        elif title is None and len(t) < 100:
            title = t
        elif description is None or len(t) > len(description):
            description = t

    if price_acres is None:
        return None

    m = _PRICE_ACRES_RE.search(price_acres)
    if m is None:
        return None
    try:
        price = float(m.group(1).replace(",", ""))
        acres = float(m.group(2).replace(",", ""))
    except ValueError:
        return None

    county = ""
    if address:
        cm = _ADDRESS_RE.search(address)
        if cm:
            captured = cm.group(2).strip()
            # Some pages include "County" inside the captured name (e.g. when
            # the address contains "Valley County, MT, 59230, Valley County").
            # Only append the suffix if it isn't already present.
            if captured.lower().endswith("county"):
                county = captured
            else:
                county = f"{captured} County"

    combined_desc = description or ""
    if address:
        combined_desc = f"{address} — {combined_desc}".strip(" —")

    # Title fallback chain: real title link > street-or-city from address
    # > generic "Land in STATE". On pages 2+ LandWatch often omits the
    # title link entirely, so the address locality is the best label.
    final_title = title
    if not final_title and address:
        loc_match = _ADDRESS_LOCALITY_RE.match(address)
        if loc_match:
            final_title = f"{loc_match.group(1).strip()}, {state}"
    if not final_title:
        final_title = f"Land in {state}"

    return {
        "id": pid,
        "title": final_title,
        "price": price,
        "acres": acres,
        "state": state,
        "county": county,
        "url": url,
        "description": combined_desc[:500],
    }


# ─── HTML parser (for requests/selenium output) ──────────────────────────────


def _extract_card_data(card: Any, state: str) -> dict[str, Any] | None:
    """Extract data from an HTML listing card element (BeautifulSoup)."""
    try:
        title_el = card.select_one(
            "h2, h3, .property-title, [data-testid='property-title']"
        )
        price_el = card.select_one(".price, [data-testid='price'], .listing-price")
        acres_el = card.select_one(".acres, [data-testid='acres'], .acreage")
        link_el = card.select_one("a[href]")
        location_el = card.select_one(".location, .county, [data-testid='location']")

        if not (title_el and price_el and link_el):
            return None

        price_text = re.sub(r"[^\d.]", "", price_el.get_text())
        acres_text = re.sub(r"[^\d.]", "", acres_el.get_text() if acres_el else "0")

        href = link_el.get("href", "")
        listing_id = re.search(r"/(\d+)/?$", href)

        return {
            "id": listing_id.group(1) if listing_id else href,
            "title": title_el.get_text(strip=True),
            "price": float(price_text) if price_text else 0,
            "acres": float(acres_text) if acres_text else 0,
            "state": state,
            "county": location_el.get_text(strip=True) if location_el else "",
            "url": (
                f"https://www.landwatch.com{href}" if href.startswith("/") else href
            ),
            "description": card.get_text(separator=" ", strip=True)[:500],
        }
    except (AttributeError, ValueError):
        return None


# ─── Scraper ─────────────────────────────────────────────────────────────────


class LandWatchScraper(BaseScraper):
    """Scraper for LandWatch.com land listings."""

    SOURCE_NAME = "landwatch"
    BASE_URL = "https://www.landwatch.com"
    RATE_LIMIT_SECONDS = 2.5

    def _state_url(self, state: str, page: int) -> str:
        slug = slug_for(state)
        if not slug:
            return ""
        base = f"{self.BASE_URL}/{slug}-land-for-sale"
        return base if page == 1 else f"{base}/page-{page}"

    def get_page_urls(self, state: str, max_pages: int = 5) -> list[str]:
        """Return search URLs — used by AI fallback when fetch() returns 0."""
        urls = [self._state_url(state, p) for p in range(1, max_pages + 1)]
        return [u for u in urls if u]

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch listings via the adaptive strategy chain.

        Dispatches parsing based on the content type returned by the chain:
        HTML → BeautifulSoup card parser; markdown → markdown regex parser.
        """
        results: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            url = self._state_url(state, page)
            if not url:
                log.info(f"[landwatch] unknown state {state}; skipping")
                return results

            try:
                fetch_result = self.fetch_page(url)
            except AllStrategiesFailed as e:
                log.info(f"[landwatch] all strategies failed for {url}: {e}")
                break
            except Exception as e:  # pragma: no cover — defensive
                log.info(f"[landwatch] fetch error for {url}: {e}")
                break

            if fetch_result.content_type == "markdown":
                page_results = parse_markdown_listings(fetch_result.content, state)
            else:
                page_results = self._parse_html_page(fetch_result.content, state)

            log.info(
                f"[landwatch] {state} page {page}: "
                f"{len(page_results)} listings "
                f"(via {fetch_result.strategy_name}, {fetch_result.content_type})"
            )
            if not page_results:
                # Empty page — stop paginating to save quota
                break
            results.extend(page_results)

        return results

    def _extract_images_by_pid(self, soup: Any) -> dict[str, list[str]]:
        """Walk the soup and collect image URLs grouped by PID.

        Strategy: for every `<img>` element, find its nearest ancestor
        that contains a `<a href=".../pid/N">` anchor. Map image → pid.
        LandWatch search cards put the gallery image inside the same
        `<article>` / `<div>` wrapper as the listing link, so this
        catches the card thumbnail reliably even when LandWatch's DOM
        class names rotate.
        """
        by_pid: dict[str, list[str]] = {}
        for img in soup.find_all("img"):
            src = (img.get("src") or img.get("data-src") or "").strip()
            if not src or src.startswith("data:"):
                continue
            # Heuristic: LandWatch embeds tiny spacer GIFs + shared
            # header logos. Skip anything < 50 chars (generally an
            # inline data-uri or relative UI asset) or known non-
            # listing domains.
            if len(src) < 50:
                continue
            # Walk up until we find a node containing a /pid/ anchor
            node = img
            for _ in range(6):
                if node is None or node.parent is None:
                    break
                node = node.parent
                anchor = node.find("a", href=True) if hasattr(node, "find") else None
                if anchor and "/pid/" in anchor.get("href", ""):
                    m = re.search(r"/pid/(\d+)", anchor["href"])
                    if m:
                        pid = m.group(1)
                        imgs = by_pid.setdefault(pid, [])
                        if src not in imgs:
                            imgs.append(src)
                    break
        return by_pid

    def _parse_html_page(self, html: str, state: str) -> list[dict[str, Any]]:
        """Parse an HTML listing page.

        Three tiers of parsing, from most structured to most resilient:
          1. BS4 card selectors — stable when LandWatch ships matching
             `data-testid` / `.property-card` attributes.
          2. JSON-LD — stable when they embed structured data.
          3. Regex pseudo-markdown — LandWatch's HTML always has
             `<a href=".../pid/N">` clusters around each listing. Reusing
             the markdown parser after converting anchors to `[text](url)`
             format keeps one regex as the source of truth and works
             regardless of DOM changes.
        """
        soup = self.parse_html(html)
        images_by_pid = self._extract_images_by_pid(soup)
        cards = soup.select(
            "[data-testid='property-card'], .property-card, article.listing"
        )
        if cards:
            results = [
                listing
                for card in cards
                if (listing := _extract_card_data(card, state)) is not None
            ]
            if results:
                return results

        # JSON-LD fallback
        import json as _json

        jsonld_results: list[dict[str, Any]] = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = _json.loads(script.string or "")
            except (_json.JSONDecodeError, AttributeError):
                continue
            if isinstance(data, list):
                jsonld_results.extend(data)
            elif isinstance(data, dict) and data.get("@type") == "ItemList":
                jsonld_results.extend(data.get("itemListElement", []))
        if jsonld_results:
            return jsonld_results

        # Regex fallback — convert every `<a href=".../pid/N">text</a>`
        # to pseudo-markdown `[text](url)` so the markdown parser can
        # handle both formats uniformly.
        pseudo_md_parts: list[str] = []
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            if "/pid/" not in href:
                continue
            if href.startswith("/"):
                href = f"https://www.landwatch.com{href}"
            text = anchor.get_text(" ", strip=True)
            if text:
                pseudo_md_parts.append(f"[{text}]({href})")
        # Append raw body text so price/acres/address regexes have
        # content to latch onto after the link clusters.
        body_text = soup.get_text(" ", strip=True)
        pseudo_markdown = "\n".join(pseudo_md_parts) + "\n\n" + body_text
        listings = parse_markdown_listings(pseudo_markdown, state)
        # Stamp captured image URLs back onto each listing by PID. Works
        # even when the markdown parser couldn't extract images itself
        # (it never could — the regex only handles links, not <img>
        # tags). For PIDs where we didn't see an <img> (LandWatch lazy-
        # loads most thumbnails via JS that curl_cffi never runs), fall
        # back to the stable CDN URL pattern:
        #   assets.landwatch.com/resizedimages/360/990/l/80/1-<PID>
        # That endpoint 200s from a browser even without a Referer, so
        # a direct <img src> hotlink works — no proxy, no storage.
        for listing in listings:
            pid = str(listing.get("id", ""))
            if not pid:
                continue
            explicit = images_by_pid.get(pid)
            if explicit:
                listing["images"] = explicit
            else:
                # Synthesized primary thumbnail. Safe to include even if
                # the asset is missing — the frontend falls through to
                # the weserv proxy and then the placeholder on 404/error.
                listing["images"] = [
                    f"https://assets.landwatch.com/resizedimages/360/990/l/80/1-{pid}"
                ]
        return listings

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a raw listing dict (from either path) into a RawListing."""
        try:
            price = float(raw.get("price", 0))
            acres = float(raw.get("acres", 0))

            if price <= 0 or acres <= 0:
                return None

            description = raw.get("description", "")
            title = raw.get("title", "")
            combined_text = f"{title} {description}"
            images = [u for u in (raw.get("images") or []) if isinstance(u, str) and u]

            return RawListing(
                external_id=str(raw.get("id", "")),
                title=title or f"Land in {raw.get('state', '')}",
                price=price,
                acreage=acres,
                state=raw.get("state", ""),
                county=raw.get("county", ""),
                lat=raw.get("lat"),
                lng=raw.get("lng"),
                features=extract_features(combined_text),
                description=description,
                days_on_market=raw.get("daysOnMarket"),
                url=raw.get("url", ""),
                images=images,
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None
