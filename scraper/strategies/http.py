"""Tier 1: Simple HTTP fetch strategy using requests."""

from __future__ import annotations

import random
import time
from typing import Any

import requests

from config import USER_AGENT, DEFAULT_RATE_LIMIT
from strategies.base import FetchResult, FetchStrategy


class SimpleHTTPStrategy(FetchStrategy):
    """Fetch pages via requests with browser-like headers and rate limiting."""

    name = "http"

    def __init__(self, rate_limit: float = DEFAULT_RATE_LIMIT) -> None:
        self.rate_limit = rate_limit
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

    def _sleep(self) -> None:
        """Respect rate limit with jitter."""
        elapsed = time.monotonic() - self._last_request
        delay = self.rate_limit + random.uniform(0.1, 0.5)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request = time.monotonic()

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Fetch URL with rate limiting. Raises on HTTP errors."""
        self._sleep()
        params = kwargs.get("params")
        response = self.session.get(url, timeout=15, params=params)
        response.raise_for_status()
        return FetchResult(
            content=response.text,
            content_type="html",
            status_code=response.status_code,
            strategy_name=self.name,
        )
