"""Tier 2: Playwright browser fetch strategy for JS-rendered pages."""

from __future__ import annotations

import time
from typing import Any

from strategies.base import FetchResult, FetchStrategy

# Reuse browser across fetches within a single run
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
        ],
    )
    return _browser


class BrowserStrategy(FetchStrategy):
    """Fetch pages using Playwright's headless Chromium.

    Better than Selenium for anti-bot evasion — Playwright patches
    navigator.webdriver and other detection vectors by default.
    """

    name = "browser"

    def __init__(
        self, headless: bool = True, timeout: int = 15000, wait_seconds: float = 2.0
    ) -> None:
        self.headless = headless
        self.timeout = timeout  # milliseconds for Playwright
        self.wait_seconds = wait_seconds

    def is_available(self) -> bool:
        """Check if playwright is importable and browsers are installed."""
        try:
            import importlib.util

            return importlib.util.find_spec("playwright") is not None
        except (ImportError, ValueError):
            return False

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Load page in Chromium and return rendered HTML."""
        browser = _get_browser(headless=self.headless)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
        )
        page = context.new_page()

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
