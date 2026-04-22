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
    # Pivot 2026-04-21: Ozark pilot. MO is the hybrid-state flagship
    # (lien-style 1st/2nd offerings + deed 3rd offerings in the same
    # county). AR adds a redeemable-deed variant via the statewide
    # Commissioner of State Lands + Carroll County (Eureka Springs) for
    # the homestead-adjacent inventory. All prior-state listings are
    # archived under data/archive/2026-04-21_pre_mo_ar_pivot/.
    "TARGET_STATES",
    "MO,AR",
).split(",")

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
    # Ozark owner-finance specialists (MO/AR only) — tiny inventory
    # but ICP-perfect.
    "homestead_crossing": True,
    "ozarkland": True,
    # United Country Real Estate — rural-specialist franchise with
    # Ozark offices (Willow Springs MO, Mountain Home AR, etc).
    # Inventory largely absent from LandWatch / Land.com aggregators,
    # high "hidden gem" ratio per homestead thesis.
    "united_country": True,
    "zillow": False,  # Rate limiting issues — disabled by default
    "realtor": False,  # Rate limiting issues — disabled by default
    "county_tax": True,
    "auction": True,
    "blm": True,
    "govease": True,
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
