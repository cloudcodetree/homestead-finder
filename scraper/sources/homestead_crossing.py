"""Homestead Crossing scraper — https://homesteadcrossing.com

MO/AR owner-finance Ozark specialist based in Willow Springs, MO.
Backed by Rent Manager (server-rendered). ~20-30 listings at a time
across /missouri/ and /arkansas/ inventory pages. Per-listing URL
shape: `/detail/?uid=<numeric_id>`.

Scraper strategy: Firecrawl the two state pages to get markdown,
regex-extract the uid + price/acreage/location from each card, emit
RawListing dicts. Firecrawl usage: 2 calls/day total (one per state).
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from logger import get_logger

from .base import BaseScraper, RawListing
from .landwatch import extract_features

log = get_logger("scraper.homestead_crossing")


def parse_homestead_crossing_html(
    html: str, default_state: str
) -> list[dict[str, Any]]:
    """Parse HomesteadCrossing's Rent Manager-rendered HTML directly.

    Each card is a `<div class="rmwb_listing-wrapper">` with:
      - data-acreage="4.5"   (on the wrapper)
      - data-status="Sold|Available" (on the wrapper — skip Sold)
      - <h2>Title</h2>       (inside .rmwb_main-header)
      - <h3>County: Oregon</h3>
      - <a href="/detail/?uid=N">
      - <li> pairs with .rmwb_info-title ("Purchase Price") +
        .rmwb_info-detail ("$39,900.00")
    """
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    results: list[dict[str, Any]] = []
    for card in soup.select(".rmwb_listing-wrapper"):
        raw_status = (card.get("data-status") or "").strip().lower()
        # Map source-side statuses onto the app's status vocabulary.
        # We no longer drop sold/pending — including them as
        # under-contract / expired rows lets the frontend offer a
        # filter toggle (default hides them) while still surfacing
        # the inventory in the data file for anyone who wants to
        # dig through recent market activity.
        if raw_status in ("sold",):
            listing_status = "expired"
        elif raw_status in ("pending", "under contract", "contract"):
            listing_status = "pending"
        else:
            listing_status = "active"

        link = card.select_one("a[href*='/detail/?uid=']")
        if not link:
            continue
        href = link.get("href", "").strip()
        uid_match = re.search(r"uid=(\d+)", href)
        if not uid_match:
            continue
        uid = uid_match.group(1)
        url = href if href.startswith("http") else f"https://homesteadcrossing.com{href}"

        # Image capture — Rent Manager renders parcel photos inside the
        # `.rmwb_photo-section` with signed `rentmanager.com` CDN URLs.
        # Multiple photos possible per card (carousel on the detail page);
        # card usually shows just the primary. We grab every <img src=> we
        # can find under the card so later scrapes can replace the primary
        # as the source re-orders without losing history.
        images: list[str] = []
        for img in card.select("img"):
            src = (img.get("src") or img.get("data-src") or "").strip()
            if src and not src.startswith("data:") and src not in images:
                images.append(src)

        title_el = card.select_one("h2")
        title = (
            title_el.get_text(strip=True) if title_el else f"Homestead Crossing {uid}"
        )

        county_el = card.select_one("h3")
        county_raw = county_el.get_text(strip=True) if county_el else ""
        # "County: Oregon" — strip the prefix
        county_match = re.match(r"county:\s*(.+)", county_raw, re.IGNORECASE)
        county_name = county_match.group(1).strip() if county_match else ""
        county = (
            county_name
            if county_name.lower().endswith("county") or not county_name
            else f"{county_name} County"
        )

        # Acreage — data-acreage attribute first, fall back to list item.
        acres = 0.0
        raw_acreage = card.get("data-acreage") or ""
        if raw_acreage:
            try:
                acres = float(raw_acreage)
            except ValueError:
                pass

        # Price, state hints — pull from the info-detail list
        price = 0.0
        state = ""
        for li in card.select("li"):
            title_span = li.select_one(".rmwb_info-title")
            detail_span = li.select_one(".rmwb_info-detail")
            if not (title_span and detail_span):
                continue
            label = title_span.get_text(strip=True).lower()
            value = detail_span.get_text(strip=True)
            if "purchase price" in label:
                price_match = re.search(r"([\d,]+(?:\.\d+)?)", value)
                if price_match:
                    try:
                        price = float(price_match.group(1).replace(",", ""))
                    except ValueError:
                        pass
            elif "state" in label:
                vu = value.upper()
                if "MO" in vu or "MISSOURI" in vu:
                    state = "MO"
                elif "AR" in vu or "ARKANSAS" in vu:
                    state = "AR"

        # State fallback: infer from card text (MO/AR is nearly always
        # present in the Ozark context — the county often encodes it).
        if not state:
            card_text = card.get_text(" ", strip=True).upper()
            if "MISSOURI" in card_text:
                state = "MO"
            elif "ARKANSAS" in card_text:
                state = "AR"
            else:
                state = default_state

        if price <= 0 or acres <= 0:
            continue

        description = card.get_text(" ", strip=True)[:1500]
        results.append(
            {
                "id": uid,
                "title": title,
                "url": url,
                "price": price,
                "acres": acres,
                "state": state,
                "county": county,
                "description": description,
                "images": images,
                "listingStatus": listing_status,
            }
        )
    return results


# Markdown link shape used by the site: [label](https://homesteadcrossing.com/detail/?uid=1445)
# Match any link pointing at /detail/?uid=<digits>, capture the label and uid.
_LISTING_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((https?://(?:www\.)?homesteadcrossing\.com/detail/\?uid=(\d+))\)"
)
# Price + acreage appear in the card body — shapes we've seen in the wild:
#   "$24,900 · 5.2 acres"     "5 acres • $24,900"     "$24,900 - 5 ac"
# The parser greps the cluster around each listing link for whichever
# ordering matches.
_PRICE_RE = re.compile(r"\$([\d,]+)(?:\.\d{2})?")
_ACRES_RE = re.compile(r"([\d.]+)\s*(?:\+/-\s*)?(?:acres?|ac\b)", re.IGNORECASE)
# Location hint: "Howell County, MO" or "Carroll, AR"
_COUNTY_RE = re.compile(
    r"([A-Z][A-Za-z\s\-]+?)(?:\s+County)?,\s*(MO|AR|Missouri|Arkansas)\b"
)


def parse_homestead_crossing_markdown(
    markdown: str, default_state: str
) -> list[dict[str, Any]]:
    """Extract listing dicts from a Firecrawl markdown dump of /missouri/
    or /arkansas/. Returns one dict per unique uid.

    Each listing on the page is a card with the detail link repeated
    in a few places (image, title, "View" button). We group by uid and
    look at the *text around* the first occurrence of each uid in the
    raw markdown for the price/acreage fields.
    """
    if not markdown:
        return []

    # First pass: collect every link cluster by uid and remember ALL
    # positions where each uid appears so we can find the first/last
    # slot later. The "window" for price/acres/county must be strictly
    # FORWARD — peeking backward would pull in the previous card's
    # fields for sibling listings that sit close together on the page.
    seen_uids: dict[str, dict[str, Any]] = {}
    all_link_positions: list[tuple[int, str]] = []
    for match in _LISTING_LINK_RE.finditer(markdown):
        label = match.group(1).strip()
        url = match.group(2)
        uid = match.group(3)
        all_link_positions.append((match.start(), uid))
        if uid in seen_uids:
            # Already captured; maybe upgrade the title if this label
            # looks more descriptive (longer, has commas).
            existing = seen_uids[uid]
            if (
                not existing["title"]
                and label
                and label.lower() not in ("view", "view details", "more info")
            ):
                existing["title"] = label
            continue
        seen_uids[uid] = {
            "uid": uid,
            "url": url,
            "title": label
            if label.lower() not in ("view", "view details", "more info")
            else "",
            "_start": match.start(),
        }

    # Precompute the "next card boundary" for each uid's first link —
    # defined as the earliest position of any OTHER uid's link after
    # this card's first link. Anything between is this card's body.
    next_boundary: dict[str, int] = {}
    for uid, info in seen_uids.items():
        this_start = info["_start"]
        later_others = [
            pos for pos, other_uid in all_link_positions
            if pos > this_start and other_uid != uid
        ]
        next_boundary[uid] = min(later_others) if later_others else len(markdown)

    listings: list[dict[str, Any]] = []
    for uid, info in seen_uids.items():
        # Forward-only window from this card's first link to the next
        # distinct card (or a sane cap). Everything in between is the
        # card body — price/acres/county live here.
        start = info["_start"]
        end = min(len(markdown), next_boundary[uid], start + 800)
        window = markdown[start:end]

        price_match = _PRICE_RE.search(window)
        acres_match = _ACRES_RE.search(window)
        county_match = _COUNTY_RE.search(window)
        if not price_match or not acres_match:
            continue
        try:
            price = float(price_match.group(1).replace(",", ""))
            acres = float(acres_match.group(1))
        except ValueError:
            continue
        if price <= 0 or acres <= 0:
            continue

        if county_match:
            raw_county = county_match.group(1).strip()
            state_text = county_match.group(2).upper()
            state = (
                "MO"
                if state_text in ("MO", "MISSOURI")
                else "AR"
                if state_text in ("AR", "ARKANSAS")
                else default_state
            )
            county = (
                raw_county
                if raw_county.lower().endswith("county")
                else f"{raw_county} County"
            )
        else:
            state = default_state
            county = ""

        listings.append(
            {
                "id": uid,
                "title": info["title"] or f"Homestead Crossing parcel {uid}",
                "url": info["url"],
                "price": price,
                "acres": acres,
                "state": state,
                "county": county,
                "description": window.strip(),
            }
        )
    return listings


class HomesteadCrossingScraper(BaseScraper):
    """Scrape Homestead Crossing's MO + AR inventory pages.

    Owner-financed Ozark land — exactly the homestead-finder ICP. The
    inventory is small (~20-30) but signal-to-noise is high: every
    listing is rural MO/AR acreage, most with seller financing and
    no-credit-check terms. Free Firecrawl tier is plenty for the 2
    calls/day this scraper makes.
    """

    SOURCE_NAME = "homestead_crossing"
    BASE_URL = "https://homesteadcrossing.com"
    RATE_LIMIT_SECONDS = 3.0

    # The site groups inventory into two state pages.
    _STATE_URLS = {
        "MO": "https://homesteadcrossing.com/missouri/",
        "AR": "https://homesteadcrossing.com/arkansas/",
    }

    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Return raw listing dicts for the given state. max_pages is
        ignored — the site renders all inventory on a single page."""
        state_url = self._STATE_URLS.get(state.upper())
        if not state_url:
            return []  # not an MO/AR state — nothing to fetch

        try:
            fetch_result = self.fetch_page(state_url)
        except Exception as e:
            log.info(f"[homestead_crossing] fetch failed for {state_url}: {e}")
            return []

        # HTML path is preferred (Playwright renders Rent Manager's
        # `.rmwb_listing-wrapper` cards directly). Firecrawl-returned
        # markdown flows through the legacy markdown parser.
        if fetch_result.content_type == "markdown":
            items = parse_homestead_crossing_markdown(
                fetch_result.content, default_state=state.upper()
            )
        else:
            items = parse_homestead_crossing_html(
                fetch_result.content, default_state=state.upper()
            )
        # State-filter so MO page doesn't yield AR listings or vice
        # versa (Rent Manager sometimes serves both on the same wrapper).
        filtered = [item for item in items if item.get("state") == state.upper()]
        log.info(
            f"[homestead_crossing] {state}: {len(filtered)}/{len(items)} "
            f"listings parsed from {state_url} (via {fetch_result.strategy_name})"
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
        # Carry source-declared listingStatus through to the RawListing
        # so base.to_property can stamp it onto the final dict, overriding
        # the default "active". Sold/pending rows keep their flag.
        raw.setdefault("listingStatus", "active")
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
