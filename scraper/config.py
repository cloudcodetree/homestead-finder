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
    "TARGET_STATES",
    "MT,ID,WY,CO,NM,OR,TX,TN,MN,ME"
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
    "lands_of_america": True,
    "zillow": False,       # Rate limiting issues — disabled by default
    "realtor": False,      # Rate limiting issues — disabled by default
    "county_tax": True,
    "auction": True,
    "blm": True,
}

# ── Output ───────────────────────────────────────────────────────────────────
# Also save a dated snapshot (in addition to listings.json)
SAVE_DATED_SNAPSHOT: bool = True

# Load local overrides if present (gitignored)
try:
    from config_local import *  # noqa: F401, F403
except ImportError:
    pass
