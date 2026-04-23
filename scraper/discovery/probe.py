"""Stage 2: probe each candidate domain to estimate inventory volume,
detect the rendering strategy, and flag walls that would block us.

For each candidate we fetch:
  1. The homepage — detects framework (Next.js → __NEXT_DATA__,
     server-rendered, JS SPA, or captcha-walled).
  2. `/sitemap.xml` — counts URLs matching land/listing/property/
     for-sale patterns, optionally filtered to MO/AR by slug.
  3. `/robots.txt` — captured via throttle layer; noted in the report.

The probe never tries to actually parse listings — that's the human
reviewer's job once they approve a candidate. We just need enough
signal to rank.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import asdict, dataclass, field
from typing import Any

import requests

import throttle
from logger import get_logger

log = get_logger("scraper.discovery.probe")

_TIMEOUT = 12
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Heuristic patterns — tested against the sources we've shipped.
_RENDER_HINTS = {
    "next.js_ssr": (
        re.compile(r'<script id="__NEXT_DATA__"', re.IGNORECASE),
    ),
    "jsonld_places": (
        re.compile(r'application/ld\+json', re.IGNORECASE),
    ),
    "server_rendered_cards": (
        re.compile(r'class="[^"]*\b(?:listing|property|card|result)[^"]*"', re.IGNORECASE),
        re.compile(r'data-(?:listing-id|property-id|lat|lng)=', re.IGNORECASE),
    ),
    "react_spa": (
        re.compile(r'<div id="(?:root|app|__next)"></div>', re.IGNORECASE),
        re.compile(r'<noscript>[^<]*enable javascript', re.IGNORECASE),
    ),
}
_WALL_HINTS = {
    "cloudflare": (
        re.compile(r'cloudflare|cf-ray|__cf_bm|attention required', re.IGNORECASE),
    ),
    "captcha": (
        re.compile(r'recaptcha|hcaptcha|captcha challenge', re.IGNORECASE),
    ),
    "login_wall": (
        re.compile(r'(?:please )?(?:log|sign) in (?:to (?:continue|view))', re.IGNORECASE),
    ),
}

# Listing-URL shape heuristics for sitemap mining.
_LISTING_PATH_RE = re.compile(
    r"/(?:property|listing|listings|land|farm|homes?|for-sale|"
    r"land-for-sale|property-for-sale)/",
    re.IGNORECASE,
)
_STATE_IN_PATH = re.compile(
    # Matches: /missouri-, /missouri/, /arkansas-, /arkansas/,
    # /mo/, /ar/, -mo-, -ar-, -mo.html, or -####-mo-zip patterns
    r"(?:missouri|arkansas|[-/]mo[-/.]|[-/]ar[-/.])",
    re.IGNORECASE,
)


@dataclass
class ProbeReport:
    """Summary of one candidate domain for the ranker."""

    domain: str
    homepage_url: str
    homepage_status: int | None = None
    homepage_bytes: int = 0
    render_type: str = "unknown"
    walls: list[str] = field(default_factory=list)
    robots_allowed: bool = True
    sitemap_url: str | None = None
    sitemap_total_urls: int = 0
    sitemap_listing_urls: int = 0
    sitemap_state_matches: int = 0
    has_ld_json: bool = False
    has_next_data: bool = False
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _fetch(url: str, *, allow_wall: bool = True) -> tuple[int | None, str]:
    """Single plain HTTP fetch via the throttle layer. Returns (status,
    body). Swallows errors — caller interprets the sentinel response."""
    throttle.acquire(url, strict_robots=not allow_wall)
    status: int | None = None
    body = ""
    try:
        r = requests.get(
            url,
            headers={"User-Agent": _UA, "Accept-Encoding": "gzip, deflate"},
            timeout=_TIMEOUT,
            allow_redirects=True,
        )
        status = r.status_code
        body = r.text if status < 500 else ""
    except (requests.RequestException, OSError) as e:
        log.info(f"[probe] {url}: {type(e).__name__}: {e}")
    finally:
        throttle.release(url, status)
    return status, body


def _classify_render(body: str) -> tuple[str, list[str]]:
    """Return (render_type, walls) based on homepage body."""
    walls = [w for w, pats in _WALL_HINTS.items() if any(p.search(body) for p in pats)]
    # Order matters — check strongest signals first
    if any(p.search(body) for p in _RENDER_HINTS["next.js_ssr"]):
        return "next.js_ssr", walls
    if any(p.search(body) for p in _RENDER_HINTS["server_rendered_cards"]):
        return "server_rendered_cards", walls
    if any(p.search(body) for p in _RENDER_HINTS["jsonld_places"]):
        return "jsonld_places", walls
    if any(p.search(body) for p in _RENDER_HINTS["react_spa"]):
        return "react_spa", walls
    return "unknown", walls


def _count_sitemap(xml_text: str) -> tuple[int, int, int]:
    """Return (total_urls, listing_urls, state_matching_urls).

    Doesn't recurse into sitemap-index children — for a rough
    inventory estimate one-level depth is fine.
    """
    urls = re.findall(r"<loc>([^<]+)</loc>", xml_text)
    total = len(urls)
    listings = [u for u in urls if _LISTING_PATH_RE.search(u)]
    state_hits = [u for u in listings if _STATE_IN_PATH.search(u)]
    return total, len(listings), len(state_hits)


def probe(domain: str) -> ProbeReport:
    """Run the full probe for one domain."""
    homepage_url = f"https://{domain}/"
    sitemap_url = f"https://{domain}/sitemap.xml"
    report = ProbeReport(domain=domain, homepage_url=homepage_url)

    status, body = _fetch(homepage_url)
    report.homepage_status = status
    report.homepage_bytes = len(body)
    if status is None or status >= 500:
        report.error = f"homepage unreachable (status={status})"
        return report
    report.render_type, report.walls = _classify_render(body)
    report.has_ld_json = 'application/ld+json' in body.lower()
    report.has_next_data = '__next_data__' in body.lower()

    # robots — throttle's cache already holds the parsed version, but
    # we re-check `can_fetch` on a representative listing path.
    try:
        report.robots_allowed = throttle.can_fetch(
            urllib.parse.urljoin(homepage_url, "/property/1")
        )
    except Exception:  # noqa: BLE001
        report.robots_allowed = True

    # Sitemap — if it 200s, count what's there.
    s_status, s_body = _fetch(sitemap_url)
    if s_status == 200 and "<loc>" in s_body:
        report.sitemap_url = sitemap_url
        total, listings, states = _count_sitemap(s_body)
        report.sitemap_total_urls = total
        report.sitemap_listing_urls = listings
        report.sitemap_state_matches = states

    return report
