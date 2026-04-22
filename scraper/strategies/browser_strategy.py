"""Browser fetch strategy — Playwright Chromium with stealth patches.

Our zero-cost alternative to Firecrawl. Passes Cloudflare on LandWatch,
Lands of America, Bid4Assets, and most anti-bot walls by running a real
Chromium from the user's residential IP with `playwright-stealth`
patches applied to hide the automation signals Cloudflare looks for
(navigator.webdriver, missing plugins, languages, hairline, etc).
"""

from __future__ import annotations

import time
from typing import Any

from strategies.base import FetchResult, FetchStrategy

# Reuse browser across fetches within a single run to amortize launch
# cost (~1s). Context is per-fetch for isolation — cookies/storage
# don't leak between sites, which matters because different sites set
# conflicting bot-detection cookies.
_browser = None
_playwright_instance = None


def _get_browser(headless: bool = True) -> Any:
    """Lazily initialize and reuse a Playwright browser."""
    global _browser, _playwright_instance
    if _browser is not None:
        return _browser

    from playwright.sync_api import sync_playwright

    _playwright_instance = sync_playwright().start()
    _browser = _playwright_instance.chromium.launch(
        headless=headless,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
        ],
    )
    return _browser


def _apply_stealth(page: Any) -> None:
    """Apply playwright-stealth patches to a page. No-op if the library
    isn't available (older installs) — callers still get baseline
    Playwright anti-detection but won't pass stricter CF challenges."""
    try:
        from playwright_stealth import Stealth

        # v2 API: Stealth().apply_stealth_sync(page)
        Stealth().apply_stealth_sync(page)
    except (ImportError, AttributeError):
        try:
            # v1 API fallback
            from playwright_stealth import stealth_sync  # type: ignore[import-not-found]

            stealth_sync(page)
        except (ImportError, AttributeError):
            # No stealth lib at all — continue with baseline Playwright.
            pass


class BrowserStrategy(FetchStrategy):
    """Fetch pages using stealth-patched Playwright Chromium.

    Strategy order in our chains puts this BEFORE Firecrawl: Playwright
    runs from the user's residential IP, which Cloudflare trusts more
    than datacenter IPs Firecrawl uses. No per-request cost either.
    """

    name = "browser"

    def __init__(
        self, headless: bool = True, timeout: int = 15000, wait_seconds: float = 2.0
    ) -> None:
        self.headless = headless
        self.timeout = timeout  # milliseconds for Playwright
        self.wait_seconds = wait_seconds

    def is_available(self) -> bool:
        """Check if playwright is importable. Browsers binary is checked
        lazily — `_get_browser()` will raise if Chromium isn't installed,
        and the chain will move to the next strategy."""
        try:
            import importlib.util

            return importlib.util.find_spec("playwright") is not None
        except (ImportError, ValueError):
            return False

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Load page in Chromium with stealth, return rendered HTML."""
        browser = _get_browser(headless=self.headless)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
            timezone_id="America/Chicago",
        )
        page = context.new_page()
        _apply_stealth(page)

        try:
            response = page.goto(
                url, timeout=self.timeout, wait_until="domcontentloaded"
            )
            # Wait for JS to render dynamic content
            time.sleep(self.wait_seconds)
            # Also wait for network to settle
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass  # networkidle timeout is OK — some sites never stop loading

            html = page.content()
            status = response.status if response else 200

            if status >= 400:
                raise RuntimeError(f"HTTP {status} from {url}")

            # Cloudflare challenge pages return 200 but only contain a
            # "Just a moment..." title. Detect + wait briefly for the
            # auto-solve to complete before giving up.
            if "Just a moment" in html and "challenge" in html.lower():
                time.sleep(4.0)
                html = page.content()

            return FetchResult(
                content=html,
                content_type="html",
                status_code=status,
                strategy_name=self.name,
            )
        finally:
            page.close()
            context.close()

    def cleanup(self) -> None:
        """Close the browser and Playwright instance."""
        global _browser, _playwright_instance
        if _browser is not None:
            try:
                _browser.close()
            except Exception:
                pass
            _browser = None
        if _playwright_instance is not None:
            try:
                _playwright_instance.stop()
            except Exception:
                pass
            _playwright_instance = None
