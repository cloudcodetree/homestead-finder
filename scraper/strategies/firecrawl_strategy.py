"""Tier 3: Firecrawl API fetch strategy — returns clean markdown."""

from __future__ import annotations

import os
from typing import Any

import throttle
from strategies.base import FetchResult, FetchStrategy


class FirecrawlStrategy(FetchStrategy):
    """Fetch pages via Firecrawl API, returning markdown content."""

    name = "firecrawl"

    def __init__(self) -> None:
        self._client: Any = None

    def _get_client(self) -> Any:
        """Lazily initialize the Firecrawl client."""
        if self._client is None:
            from firecrawl import FirecrawlApp

            self._client = FirecrawlApp(api_key=os.environ["FIRECRAWL_API_KEY"])
        return self._client

    def is_available(self) -> bool:
        """Check for firecrawl package and API key."""
        if not os.getenv("FIRECRAWL_API_KEY"):
            return False
        try:
            import firecrawl  # noqa: F401

            return True
        except ImportError:
            return False

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Scrape URL via Firecrawl and return markdown.

        Firecrawl fetches the target URL from its own datacenter, so
        the throttle clock is keyed on THAT target domain (not on
        api.firecrawl.dev). Rate-limiting and robots checks apply to
        the end site — Firecrawl itself manages its own quota. Daily
        per-domain quota matters here too: a runaway chain could burn
        Firecrawl credits fast.
        """
        throttle.acquire(url)
        status: int | None = None
        try:
            client = self._get_client()
            result = client.scrape_url(url, params={"formats": ["markdown"]})
            markdown = result.get("markdown", "")
            if not markdown:
                raise ValueError(f"Firecrawl returned empty markdown for {url}")
            status = 200
            return FetchResult(
                content=markdown,
                content_type="markdown",
                status_code=200,
                strategy_name=self.name,
                cost=0.001,  # rough per-page cost estimate
            )
        finally:
            throttle.release(url, status)
