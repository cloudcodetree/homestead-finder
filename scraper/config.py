"""Scraper configuration — override with environment variables or config_local.py."""

from __future__ import annotations

import os
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
DATA_DIR = REPO_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

# ── Target geography ─────────────────────────────────────────────────────────
# States to scrape. Expand as budget/rate-limit allows.
TARGET_STATES: list[str] = os.getenv(
    # Pivot 2026-04-29: greater Austin TX. The MO/AR pilot corpus
    # (2,426 listings) is archived at `data/archive/2026-04-29-mo-ar/`
    # and can be restored by copying those files back into `data/`
    # and flipping this default back to "MO,AR".
    #
    # We scrape the whole state at the source level (LandWatch et al.
    # only filter by state, not county) and trim post-scrape via
    # TARGET_COUNTIES below — without that filter we'd ingest all 254
    # TX counties and drown the corpus in non-Austin inventory.
    "TARGET_STATES",
    "TX",
).split(",")

# Sub-state filter applied after the source scrape returns. Empty
# list = no filter (use the full TARGET_STATES result). Keys are
# `<STATE>|<county-lower-no-suffix>` matching the voting/macro
# table key shape so the same normalization helper works on both.
#
# Pivot 2026-04-29: Austin–Round Rock MSA (5 counties). Hill Country
# (Burnet, Blanco, Llano) deferred until inventory needs it.
TARGET_COUNTIES: list[str] = [
    "TX|travis",
    "TX|williamson",
    "TX|hays",
    "TX|bastrop",
    "TX|caldwell",
]

# ── Deal criteria ────────────────────────────────────────────────────────────
MIN_ACREAGE: float = float(os.getenv("MIN_ACREAGE", "5"))
MAX_PRICE: float = float(os.getenv("MAX_PRICE", "1000000"))
MAX_PRICE_PER_ACRE: float = float(os.getenv("MAX_PRICE_PER_ACRE", "10000"))

# ── Notification ─────────────────────────────────────────────────────────────
SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
NOTIFICATION_EMAIL: str = os.getenv("NOTIFICATION_EMAIL", "")
NOTIFICATION_SCORE_THRESHOLD: int = int(os.getenv("NOTIFICATION_SCORE_THRESHOLD", "75"))

# ── Scraper behavior ─────────────────────────────────────────────────────────
# Max pages to fetch per source per state (set low to be polite)
MAX_PAGES_PER_SOURCE: int = int(os.getenv("MAX_PAGES_PER_SOURCE", "5"))

# Default delay between requests (seconds)
DEFAULT_RATE_LIMIT: float = float(os.getenv("DEFAULT_RATE_LIMIT", "2.0"))

# User agent for HTTP requests
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ── Active sources ────────────────────────────────────────────────────────────
# Set to False to disable a source without removing it
ENABLED_SOURCES: dict[str, bool] = {
    "landwatch": True,
    # Lands of America redirects all traffic to land.com (same parent,
    # rebranded 2025). land.com is a JS-rendered aggregator that
    # duplicates LandWatch inventory — disabled until we verify unique
    # inventory justifies the Playwright cost.
    "lands_of_america": False,
    # Ozark owner-finance specialists (MO/AR only). Disabled
    # 2026-04-29 with the Austin TX pivot — neither vendor lists
    # Texas inventory. Re-enable on revert.
    "homestead_crossing": False,
    "ozarkland": False,
    # United Country Real Estate — rural-specialist franchise with
    # Ozark offices (Willow Springs MO, Mountain Home AR, etc).
    # Inventory largely absent from LandWatch / Land.com aggregators,
    # high "hidden gem" ratio per homestead thesis.
    "united_country": True,
    # Mossy Oak Properties — hunting/rec land specialist franchise.
    # Server-rendered, lat/lng baked into card data attributes, heavy
    # Ozark coverage. Hidden-gem yield similar to United Country.
    "mossy_oak": True,
    # Craigslist FSBO land — disabled at the registry level
    # (`scraper/main.py:ALL_SCRAPERS`) on 2026-04-28 because of a
    # broken URL builder. Listed here as False for consistency.
    "craigslist": False,
    # LandHub.com — independent aggregator outside the Land.com family.
    # MO carries ~1,666 active rows, AR ~686. Plain HTTP works, the
    # whole page ships as SSR Next.js JSON. Low overlap with LandWatch.
    "landhub": True,
    "zillow": False,  # Rate limiting issues — disabled by default
    "realtor": False,  # Rate limiting issues — disabled by default
    # county_tax: disabled 2026-04-29 with the Austin TX pivot —
    # the existing tax-sale parsers are MO/AR-county-specific.
    # TX equivalents (Travis/Williamson/Hays/Bastrop/Caldwell)
    # publish delinquent-tax sales differently per county and need
    # new parsers; deferred until the rest of the pivot is stable.
    "county_tax": False,
    "auction": True,
    "blm": True,
    "govease": True,
}

# ── Local-only sources (CI safety) ────────────────────────────────────────────
# These sources have one or more of: (a) Cloudflare bot wall that we
# bypass via curl_cffi TLS impersonation, (b) a ToS that explicitly
# forbids automated scraping, or (c) a track record of blocking
# datacenter IP ranges. GitHub Actions runner IPs are well-known to
# anti-scraping services and likelier to land in a permanent block.
# Running these from a residential IP (the developer's machine) keeps
# the blacklist risk to the laptop's IP, where rotation is cheap.
#
# When `os.environ['CI']` is truthy, main.py SKIPS these sources.
# They run only when the operator invokes `python main.py` locally.
# The CI workflow handles the merge: local-scraped JSON is committed
# by the developer; CI's daily run handles low-risk sources only.
LOCAL_ONLY_SOURCES: set[str] = {
    # Active anti-bot wall (Cloudflare TLS fingerprint check). Highest risk.
    "landwatch",
    # ToS forbids automated scraping; sapi works but a single-IP block
    # is plausible. Volume is low so daily local runs are easy.
    "craigslist",
    # Same family as LandWatch (CoStar) when re-enabled.
    "lands_of_america",
}

# ── Adaptive fetch strategies ────────────────────────────────────────────────
# API keys for fallback strategies (set via env vars or config_local.py)
FIRECRAWL_API_KEY: str = os.getenv("FIRECRAWL_API_KEY", "")
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

# Cost controls
DAILY_FIRECRAWL_LIMIT: int = int(os.getenv("DAILY_FIRECRAWL_LIMIT", "50"))
DAILY_CLAUDE_BUDGET_USD: float = float(os.getenv("DAILY_CLAUDE_BUDGET_USD", "1.00"))
AI_MAX_SPEND_PER_RUN: float = float(os.getenv("AI_MAX_SPEND_PER_RUN", "1.00"))
AI_CONFIDENCE_THRESHOLD: float = float(os.getenv("AI_CONFIDENCE_THRESHOLD", "0.7"))

# Selenium settings
SELENIUM_HEADLESS: bool = os.getenv("SELENIUM_HEADLESS", "true").lower() == "true"
SELENIUM_TIMEOUT: int = int(os.getenv("SELENIUM_TIMEOUT", "15"))

# AI learning
AI_FALLBACK_ENABLED: bool = os.getenv("AI_FALLBACK_ENABLED", "true").lower() == "true"
LEARNED_SELECTORS_DIR = DATA_DIR / "learned_selectors"

# Strategy chains per source — tried in order until one succeeds
STRATEGY_CHAINS: dict[str, list[str]] = {
    # Order is cheapest → most expensive. Strategies:
    #   - http:        plain requests. Good for server-rendered sites.
    #   - curl_cffi:   Chrome-TLS impersonation. Beats Cloudflare WAF
    #                  (LandWatch, LOA, Bid4Assets) for the price of a
    #                  plain HTTP call. ~0.8s/page, free.
    #   - selenium:    Playwright Chromium + stealth patches. Handles
    #                  JS-rendered sites (HomesteadCrossing, COSL .NET)
    #                  and harder CF challenges. ~8s/page, free.
    #   - firecrawl:   metered third-party. Paid fallback only.
    "landwatch": ["curl_cffi", "http", "selenium", "firecrawl"],
    "lands_of_america": ["curl_cffi", "http", "selenium", "firecrawl"],
    # Owner-finance boutique sites. OzarkLand is server-side WP — plain
    # HTTP works. HomesteadCrossing is JS-rendered (Rent Manager) so
    # skip curl_cffi and go straight to Playwright.
    "homestead_crossing": ["selenium", "firecrawl"],
    "ozarkland": ["http", "curl_cffi", "selenium"],
    # UCRE is a React SPA — Playwright is the only reliable fetch
    # (curl_cffi gets the empty shell, no listing data).
    "united_country": ["selenium", "firecrawl"],
    # Mossy Oak is server-rendered HTML — curl_cffi handles CF TLS
    # wall at ~0.8s per state. Playwright as a backup only.
    "mossy_oak": ["curl_cffi", "http", "selenium"],
    # Craigslist hits sapi.craigslist.org directly — handled inside
    # the scraper module. Strategy chain not used.
    "craigslist": ["curl_cffi"],
    # LandHub is plain server-rendered Next.js HTML — http works;
    # curl_cffi as a cheap TLS fallback if they ever add Cloudflare.
    "landhub": ["http", "curl_cffi", "selenium"],
    "county_tax": ["http", "curl_cffi", "selenium", "firecrawl"],
    "auction": ["curl_cffi", "selenium", "firecrawl+claude"],
    "blm": ["http", "curl_cffi", "selenium"],
    "govease": ["http", "curl_cffi", "selenium"],
    "zillow": ["curl_cffi", "http", "selenium"],
    "realtor": ["curl_cffi", "http", "selenium"],
}

# ── Output ───────────────────────────────────────────────────────────────────
# Also save a dated snapshot (in addition to listings.json)
SAVE_DATED_SNAPSHOT: bool = True

# Load local overrides if present (gitignored)
try:
    from config_local import *  # noqa: F401, F403
except ImportError:
    pass
