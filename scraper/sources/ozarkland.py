"""OzarkLand scraper — https://ozarkland.com

MO/AR Ozark owner-finance outfit. 100% seller-financed, no down
payment, 9% fixed-rate over 15 years. ~12 parcels at any given time
but every one is genuine homestead fit.

Per-listing URL shape: `/property/<slug>/`. List page at
`/land-for-sale-in-the-ozarks/`. The site renders the full inventory
server-side in plain WordPress HTML — no Firecrawl needed. We parse
the card structure directly with BeautifulSoup; the legacy markdown
parser is kept for tests (and as a fallback if we ever switch
strategies).
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.ozarkland")


# [label](https://ozarkland.com/property/jones-point-parcel-e/)
_LISTING_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((https?://(?:www\.)?ozarkland\.com/property/([a-z0-9\-]+)/?)\)"
)
_PRICE_RE = re.compile(r"\$([\d,]+)(?:\.\d{2})?")
_ACRES_RE = re.compile(r"([\d.]+)\s*(?:\+/-\s*)?(?:acres?|ac\b)", re.IGNORECASE)
_STATE_HINT_RE = re.compile(r"\b(Missouri|Arkansas|MO|AR)\b")
_COUNTY_HINT_RE = re.compile(r"([A-Z][A-Za-z\s\-]+?)\s+County\b")


def parse_ozarkland_markdown(markdown: str) -> list[dict[str, Any]]:
    """Extract listing dicts from a Firecrawl markdown dump of the
    OzarkLand inventory page. Keyed by URL slug to dedupe.
    """
    if not markdown:
        return []

    seen: dict[str, dict[str, Any]] = {}
    all_link_positions: list[tuple[int, str]] = []
    for match in _LISTING_LINK_RE.finditer(markdown):
        label = match.group(1).strip()
        url = match.group(2)
        slug = match.group(3)
        all_link_positions.append((match.start(), slug))
        if slug in seen:
            existing = seen[slug]
            if not existing["title"] and label and len(label) > 3:
                existing["title"] = label
            continue
        seen[slug] = {
            "slug": slug,
            "url": url,
            "title": label
            if len(label) > 3 and label.lower() not in ("view", "more", "details")
            else "",
            "_start": match.start(),
        }

    # Forward-only window: body of a card runs from its first link to
    # the next distinct card's first link. Prevents sibling cards from
    # stealing each other's price/county when the page lists them
    # back-to-back without much filler.
    next_boundary: dict[str, int] = {}
    for slug, info in seen.items():
        this_start = info["_start"]
        later_others = [
            pos for pos, other_slug in all_link_positions
            if pos > this_start and other_slug != slug
        ]
        next_boundary[slug] = min(later_others) if later_others else len(markdown)

    listings: list[dict[str, Any]] = []
    for slug, info in seen.items():
        start = info["_start"]
        end = min(len(markdown), next_boundary[slug], start + 800)
        window = markdown[start:end]

        price_match = _PRICE_RE.search(window)
        acres_match = _ACRES_RE.search(window)
        if not price_match or not acres_match:
            continue
        try:
            price = float(price_match.group(1).replace(",", ""))
            acres = float(acres_match.group(1))
        except ValueError:
            continue
        if price <= 0 or acres <= 0:
            continue

        state_hit = _STATE_HINT_RE.search(window)
        state = ""
        if state_hit:
            raw_state = state_hit.group(1).upper()
            state = (
                "MO"
                if raw_state in ("MO", "MISSOURI")
                else "AR"
                if raw_state in ("AR", "ARKANSAS")
                else ""
            )
        county_hit = _COUNTY_HINT_RE.search(window)
        county = f"{county_hit.group(1).strip()} County" if county_hit else ""

        # OzarkLand doesn't publish MO vs AR breakdown on the list page
        # reliably, so fall through to "MO" if we couldn't detect either.
        state = state or "MO"

        listings.append(
            {
                "id": slug,
                "title": info["title"] or f"Ozarkland parcel {slug}",
                "url": info["url"],
                "price": price,
                "acres": acres,
                "state": state,
                "county": county,
                "description": window.strip(),
            }
        )
    return listings


def parse_ozarkland_html(html: str) -> list[dict[str, Any]]:
    """Parse the OzarkLand inventory page HTML directly.

    Each listing card on the page is structured (abbreviated):

        <div class="image">
          <a href=".../property/{slug}/">...</a>
          <div class="sale">available</div>         ← status
          <div class="price">&#036;<span>34,900</span></div>
        </div>
        <div class="lower-content">
          <h3><a>Jones Point Parcel E</a></h3>
          <div class="location">Arkansas</div>
          <div class="text">description</div>
          ... <span class="icon-value">3.32 acres</span> ...
        </div>

    Skips cards where `<div class="sale">` is "sold" or "pending".
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    results: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()

    for title_link in soup.select("h3 a[href*='ozarkland.com/property/']"):
        url = title_link.get("href", "").strip()
        slug_match = re.search(r"/property/([a-z0-9\-]+)/?", url)
        if not slug_match:
            continue
        slug = slug_match.group(1)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        title = title_link.get_text(strip=True)

        # Image capture — OzarkLand cards put the parcel image in a
        # `<div class="image">` that is a SIBLING of the
        # `<div class="lower-content">` containing the `<h3>`. So from
        # the `<h3><a>` title link we need to climb three levels:
        #   h3 → upper-box → lower-content → card wrapper (target).
        # Going further up hits the grid container and its loop sibling
        # cards, which pollutes our result. WordPress lazy-loads via
        # `data-src=`; `src=` often holds a placeholder SVG, so we
        # prefer data-src when present.
        images: list[str] = []
        card_root: Any | None = title_link.find_parent("h3")
        for _ in range(3):
            if card_root is None or card_root.parent is None:
                break
            card_root = card_root.parent
        if card_root is not None:
            for img in card_root.select("img"):
                src = (img.get("data-src") or img.get("src") or "").strip()
                if not src or src.startswith("data:"):
                    continue
                if src not in images:
                    images.append(src)

        # Walk up to the card container — title <h3> sits inside
        # `<div class="lower-content">` which is sibling to the image
        # block. Grab the card's outermost ancestor that holds both.
        card = title_link.find_parent(class_=re.compile(r"listing|property|item|card"))
        if card is None:
            # Fallback: use a wide-enough ancestor that includes the
            # image/price block (typically 3-4 levels up).
            card = title_link
            for _ in range(5):
                if card.parent is None:
                    break
                card = card.parent

        card_text = card.get_text(" ", strip=True)

        # Status — Oz cards use `<div class="sale">available|sold|pending
        # </div>`. We keep the listing but map source-side status to our
        # vocabulary so the frontend can hide expired / pending rows via
        # a filter toggle.
        sale_div = card.select_one(".sale")
        status_raw = (sale_div.get_text(strip=True) if sale_div else "").lower()
        if status_raw == "sold":
            listing_status = "expired"
        elif status_raw in ("pending", "off market", "under contract"):
            listing_status = "pending"
        else:
            listing_status = "active"

        # Price — first <span class="page-price">NN,NNN</span>
        price_span = card.select_one(".page-price, .price .page-price")
        price = 0.0
        if price_span:
            try:
                price = float(price_span.get_text(strip=True).replace(",", ""))
            except ValueError:
                pass

        # Acres — first <span class="icon-value">N.NN acres</span>
        acres = 0.0
        acres_span = card.select_one(".icon-value")
        if acres_span:
            am = re.search(r"([\d.]+)", acres_span.get_text(strip=True))
            if am:
                try:
                    acres = float(am.group(1))
                except ValueError:
                    pass
        if acres <= 0:
            # Some layouts put acreage in plain text, not the icon-value
            am = re.search(r"([\d.]+)\s*acres?", card_text, re.IGNORECASE)
            if am:
                try:
                    acres = float(am.group(1))
                except ValueError:
                    pass

        # State via <div class="location">
        state = ""
        loc_div = card.select_one(".location")
        if loc_div:
            raw = loc_div.get_text(strip=True).upper()
            state = "MO" if "MISSOURI" in raw or raw == "MO" else (
                "AR" if "ARKANSAS" in raw or raw == "AR" else ""
            )
        state = state or "MO"  # Ozark default

        # County — rarely present on the card; optional
        county_match = re.search(r"([A-Z][A-Za-z\s\-]+?)\s+County", card_text)
        county = f"{county_match.group(1).strip()} County" if county_match else ""

        desc_div = card.select_one(".text")
        description = desc_div.get_text(" ", strip=True) if desc_div else ""
        if not description:
            description = card_text[:500]

        if price <= 0 or acres <= 0:
            continue

        results.append(
            {
                "id": slug,
                "title": title or f"OzarkLand parcel {slug}",
                "url": url,
                "price": price,
                "acres": acres,
                "state": state,
                "county": county,
                "description": description[:1500],
                "images": images,
                "listingStatus": listing_status,
            }
        )
    return results


class OzarkLandScraper(BaseScraper):
    """Scrape OzarkLand.com's single-page inventory of owner-financed
    Ozark parcels. Uses plain HTTP + BeautifulSoup — the site renders
    everything server-side so no Firecrawl is needed.
    """

    SOURCE_NAME = "ozarkland"
    BASE_URL = "https://ozarkland.com"
    RATE_LIMIT_SECONDS = 3.0

    _LIST_URL = "https://ozarkland.com/land-for-sale-in-the-ozarks/"

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Single-page scrape. Fetches once; `state` filters the
        returned rows. max_pages ignored."""
        try:
            response = self.get(self._LIST_URL)
            html = response.text
        except Exception as e:
            log.info(f"[ozarkland] fetch failed for {self._LIST_URL}: {e}")
            return []
        # Archive raw HTML (durability layer).
        from raw_archive import archive as _archive

        _archive("ozarkland", f"list-{state.lower()}", html, ext="html")
        items = parse_ozarkland_html(html)
        filtered = [item for item in items if item.get("state") == state.upper()]
        log.info(
            f"[ozarkland] {state}: {len(filtered)}/{len(items)} listings after "
            f"state filter from {self._LIST_URL}"
        )
        return filtered

    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        title = str(raw.get("title", "")).strip()
        price = float(raw.get("price", 0) or 0)
        acres = float(raw.get("acres", 0) or 0)
        if not title or price <= 0 or acres <= 0:
            return None
        description = str(raw.get("description", ""))[:1500]
        images = [u for u in (raw.get("images") or []) if isinstance(u, str) and u]
        return RawListing(
            external_id=str(raw.get("id", "")),
            title=title,
            price=price,
            acreage=acres,
            state=str(raw.get("state", "")).upper(),
            county=str(raw.get("county", "")),
            features=extract_features(f"{title} {description}") + ["owner_financing"],
            description=description,
            url=str(raw.get("url", "")),
            images=images,
            raw=raw,
        )
