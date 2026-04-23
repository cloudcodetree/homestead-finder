"""TLS-impersonation fetch strategy via curl-cffi.

Some sites (LandWatch being the flagship example) reject every plain
`requests` call at the TLS layer before any page content is served.
They fingerprint the TLS ClientHello + JA3 hash against known browser
profiles and drop anything that doesn't match. User-Agent, headers,
cookies — none of that matters, the TCP conversation is already over.

`curl-cffi` wraps libcurl-impersonate which replays a real Chrome TLS
handshake. CF's fingerprint check passes and we get the actual page
back as regular HTML — no JS, no browser, no Firecrawl. Tested
benchmark 2026-04-22:

    LandWatch MO: 200 OK, 348KB, 0.8s, 25 listings visible
    (Plain requests: 403 in 50ms)

Sits between SimpleHTTPStrategy and BrowserStrategy in the chain.
Free and faster than either Playwright or Firecrawl for sites where
TLS fingerprinting is the only anti-bot layer.
"""

from __future__ import annotations

import random
import time
from typing import Any

import throttle
from config import DEFAULT_RATE_LIMIT
from strategies.base import FetchResult, FetchStrategy


# Chrome version to impersonate. 131 is well-tested against CF as of
# Apr 2026 and matches the current stable channel. `chrome120` is the
# most battle-tested fallback. Both pass LandWatch's wall.
_DEFAULT_IMPERSONATE = "chrome131"


class CurlCffiStrategy(FetchStrategy):
    """Fetch pages via curl-cffi with Chrome TLS impersonation.

    Replaces Firecrawl for sites where CF's only bot defense is TLS
    fingerprinting. Doesn't help with actual JS-rendered content or
    sites that use CF Turnstile challenges — Playwright handles those.
    """

    name = "curl_cffi"

    def __init__(
        self,
        rate_limit: float = DEFAULT_RATE_LIMIT,
        impersonate: str = _DEFAULT_IMPERSONATE,
    ) -> None:
        self.rate_limit = rate_limit
        self.impersonate = impersonate
        self._last_request: float = 0.0

    def is_available(self) -> bool:
        """True iff curl_cffi is importable in this environment."""
        try:
            import importlib.util

            return importlib.util.find_spec("curl_cffi") is not None
        except (ImportError, ValueError):
            return False

    def _sleep(self) -> None:
        elapsed = time.monotonic() - self._last_request
        delay = self.rate_limit + random.uniform(0.1, 0.5)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request = time.monotonic()

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Fetch with Chrome TLS fingerprint. Raises on HTTP >= 400 so
        the chain advances to the next strategy.

        Shared throttle layer (robots.txt + per-domain bucket + 429
        backoff + daily quota) runs first; local `_sleep` stays as a
        floor when throttle is bypassed.
        """
        from curl_cffi import requests as cffi_requests

        throttle.acquire(url)
        self._sleep()
        status: int | None = None
        retry_after: float | None = None
        try:
            response = cffi_requests.get(
                url,
                impersonate=self.impersonate,
                timeout=20,
                params=kwargs.get("params"),
            )
            status = response.status_code
            if status == 429:
                ra = response.headers.get("Retry-After")
                try:
                    retry_after = float(ra) if ra else None
                except ValueError:
                    retry_after = None
            response.raise_for_status()
            return FetchResult(
                content=response.text,
                content_type="html",
                status_code=response.status_code,
                strategy_name=self.name,
            )
        finally:
            throttle.release(url, status, retry_after=retry_after)
