"""Base scraper class — all source scrapers extend this."""

from __future__ import annotations

import random
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import requests
from bs4 import BeautifulSoup

from config import (
    USER_AGENT,
    DEFAULT_RATE_LIMIT,
    STRATEGY_CHAINS,
    SELENIUM_HEADLESS,
    SELENIUM_TIMEOUT,
    AI_FALLBACK_ENABLED,
)
from logger import get_logger
from strategies.base import FetchResult, FetchStrategyChain, AllStrategiesFailed
from strategies.http import SimpleHTTPStrategy

log = get_logger("scraper")


@dataclass
class RawListing:
    """Intermediate normalized form before final Property schema."""

    external_id: str
    title: str
    price: float
    acreage: float
    state: str
    county: str
    url: str
    lat: float | None = None
    lng: float | None = None
    features: list[str] = field(default_factory=list)
    description: str = ""
    days_on_market: int | None = None
    # Image URLs captured from the source page. `images[0]` is the
    # primary thumbnail for card views; when the scraper has access to
    # a gallery (detail-page fetch) later entries are ordered as the
    # source rendered them. Empty list is fine — the frontend falls
    # through to a placeholder SVG.
    images: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


def _build_strategy_chain(source_name: str, rate_limit: float) -> FetchStrategyChain:
    """Build a FetchStrategyChain from the config for a given source."""
    chain_names = STRATEGY_CHAINS.get(source_name, ["http"])
    strategies = []

    for name in chain_names:
        if name == "http":
            strategies.append(SimpleHTTPStrategy(rate_limit=rate_limit))
        elif name in ("curl_cffi", "tls"):
            # TLS-fingerprint impersonation via curl-cffi. Faster than
            # Playwright, free, and passes the CF wall on LandWatch /
            # LOA / Bid4Assets where plain requests gets a flat 403.
            from strategies.curl_cffi_strategy import CurlCffiStrategy

            strategies.append(CurlCffiStrategy(rate_limit=rate_limit))
        elif name in ("selenium", "browser"):
            from strategies.browser_strategy import BrowserStrategy

            strategies.append(
                BrowserStrategy(
                    headless=SELENIUM_HEADLESS,
                    timeout=SELENIUM_TIMEOUT * 1000,  # convert seconds to ms
                )
            )
        elif name == "firecrawl":
            from strategies.firecrawl_strategy import FirecrawlStrategy

            strategies.append(FirecrawlStrategy())
        elif name == "firecrawl+claude":
            # Firecrawl fetch + Claude parse is handled at the scraper level,
            # not as a single strategy. We add Firecrawl here — the AI parse
            # is triggered in _try_ai_fallback() when content_type is markdown.
            from strategies.firecrawl_strategy import FirecrawlStrategy

            strategies.append(FirecrawlStrategy())

    return FetchStrategyChain(strategies)


class BaseScraper(ABC):
    """Abstract base class for all property listing scrapers."""

    SOURCE_NAME: str = ""
    BASE_URL: str = ""
    RATE_LIMIT_SECONDS: float = DEFAULT_RATE_LIMIT

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self._last_request: float = 0.0
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
            }
        )
        self.strategy_chain = _build_strategy_chain(
            self.SOURCE_NAME, self.RATE_LIMIT_SECONDS
        )

    def sleep(self) -> None:
        """Respect rate limit with jitter."""
        elapsed = time.monotonic() - self._last_request
        delay = self.RATE_LIMIT_SECONDS + random.uniform(0.1, 0.5)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request = time.monotonic()

    def get(self, url: str, **kwargs: Any) -> requests.Response:
        """Rate-limited GET request (legacy — prefer fetch_page for new code)."""
        self.sleep()
        response = self.session.get(url, timeout=15, **kwargs)
        response.raise_for_status()
        return response

    def fetch_page(self, url: str, **kwargs: Any) -> FetchResult:
        """Fetch a page using the adaptive strategy chain.

        Tries each strategy in order (HTTP → Selenium → Firecrawl etc.)
        and returns the first successful result.
        """
        return self.strategy_chain.fetch(url, **kwargs)

    def parse_html(self, html: str) -> BeautifulSoup:
        """Parse HTML with lxml."""
        return BeautifulSoup(html, "lxml")

    def to_property(self, raw: RawListing) -> dict[str, Any]:
        """Convert RawListing to the standard Property schema.

        `status="active"` is the default — every row in today's scrape
        was by definition listed-for-sale at fetch time. The county-tax
        subclass overrides this to "tax_sale". A future detail-verify
        step could demote stale rows to "expired" if an HTTP fetch of
        the listing page 404s, but without that signal we start active
        (avoids the frontend defaulting everything to the yellow
        "⚠ Unverified" badge).
        """
        price_per_acre = raw.price / raw.acreage if raw.acreage > 0 else 0
        return {
            "id": f"{self.SOURCE_NAME}_{raw.external_id}",
            "title": raw.title,
            "price": round(raw.price, 2),
            "acreage": round(raw.acreage, 2),
            "pricePerAcre": round(price_per_acre, 2),
            "location": {
                "lat": raw.lat or 0.0,
                "lng": raw.lng or 0.0,
                "state": raw.state.upper(),
                "county": raw.county,
            },
            "features": raw.features,
            "source": self.SOURCE_NAME,
            "url": raw.url,
            "dateFound": date.today().isoformat(),
            "dealScore": 0,  # Set by scoring engine after normalization
            "description": raw.description,
            "daysOnMarket": raw.days_on_market,
            # Default = "active"; sources that detect sold/pending/
            # under-contract on the card (HomesteadCrossing, OzarkLand
            # with data-status attrs) bubble that up via raw.raw and
            # we promote it here. Tax-sale subclass overrides to
            # "tax_sale" regardless. Frontend offers a filter toggle
            # to hide expired/pending when set.
            "status": (raw.raw or {}).get("listingStatus") or "active",
            # Only include `images` when we actually captured some —
            # keeps the JSON diff small for sources that don't (yet)
            # extract gallery URLs. Frontend treats absent == empty.
            **({"images": raw.images} if raw.images else {}),
        }

    @abstractmethod
    def fetch(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Fetch raw listing data from the source for a given state."""
        ...

    @abstractmethod
    def parse(self, raw: dict[str, Any]) -> RawListing | None:
        """Parse a single raw listing dict into a RawListing. Return None to skip."""
        ...

    def normalize(self, raw_listing: RawListing) -> dict[str, Any]:
        """Convert a RawListing to the standard Property schema."""
        return self.to_property(raw_listing)

    def get_page_urls(self, state: str, max_pages: int = 5) -> list[str]:
        """Return the URLs this scraper would fetch for a given state.

        Override in subclasses to enable AI fallback — the base implementation
        returns an empty list (AI fallback skipped for that source).
        """
        return []

    def _try_ai_fallback(self, state: str, max_pages: int = 5) -> list[dict[str, Any]]:
        """Try to extract listings using the AI learning pipeline.

        Called when hardcoded parse() returns 0 results.
        """
        if not AI_FALLBACK_ENABLED:
            return []

        try:
            from ai.learning import AILearningPipeline

            pipeline = AILearningPipeline(self.SOURCE_NAME)
        except ImportError:
            return []

        # Get URLs for this state
        urls = self.get_page_urls(state, max_pages)
        if not urls:
            return []

        results: list[dict[str, Any]] = []
        for url in urls:
            try:
                # Fetch raw content using strategy chain
                fetch_result = self.fetch_page(url)
                # Run AI pipeline on the content
                listings = pipeline.extract_from_content(
                    content=fetch_result.content,
                    content_type=fetch_result.content_type,
                    state=state,
                    url=url,
                )
                for listing_dict in listings:
                    raw = self._ai_dict_to_raw_listing(listing_dict, state)
                    if raw is not None:
                        results.append(self.normalize(raw))
            except AllStrategiesFailed as e:
                log.info(
                    f"[{self.SOURCE_NAME}] AI fallback: all fetch strategies failed for {url}: {e}"
                )
            except Exception as e:
                log.info(f"[{self.SOURCE_NAME}] AI fallback error for {url}: {e}")

        if results:
            print(
                f"  [{self.SOURCE_NAME}] AI fallback recovered {len(results)} listings for {state}"
            )
        return results

    def _ai_dict_to_raw_listing(
        self, d: dict[str, Any], state: str
    ) -> RawListing | None:
        """Convert an AI-extracted dict to a RawListing."""
        try:
            title = str(d.get("title", "")).strip()
            price = float(d.get("price", 0))
            acreage = float(d.get("acreage", 0))
            if not title or price <= 0 or acreage <= 0:
                return None
            return RawListing(
                external_id=str(d.get("external_id", ""))
                or f"ai_{hash(title) % 100000}",
                title=title,
                price=price,
                acreage=acreage,
                state=d.get("state", state).upper(),
                county=str(d.get("county", "")),
                url=str(d.get("url", "")),
                description=str(d.get("description", ""))[:500],
            )
        except (TypeError, ValueError):
            return None

    def scrape(self, states: list[str], max_pages: int = 5) -> list[dict[str, Any]]:
        """Main entry point: scrape all target states and return normalized properties.

        If hardcoded parsing returns 0 results for a state, the AI learning
        pipeline is invoked as a fallback.
        """
        results: list[dict[str, Any]] = []
        for state in states:
            state_results: list[dict[str, Any]] = []
            try:
                raw_items = self.fetch(state, max_pages=max_pages)
                for item in raw_items:
                    try:
                        raw_listing = self.parse(item)
                        if raw_listing is not None:
                            state_results.append(self.normalize(raw_listing))
                    except Exception as e:
                        log.info(f"[{self.SOURCE_NAME}] Parse error for item: {e}")
            except Exception as e:
                log.info(f"[{self.SOURCE_NAME}] Fetch error for {state}: {e}")

            # AI fallback: if hardcoded scraping returned nothing, try AI
            if not state_results:
                ai_results = self._try_ai_fallback(state, max_pages)
                state_results.extend(ai_results)

            results.extend(state_results)

        # Clean up strategy resources (browser sessions etc.)
        self.strategy_chain.cleanup()
        return results
