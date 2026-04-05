"""Tier 2: Selenium browser fetch strategy for JS-rendered pages."""

from __future__ import annotations

import glob
import os
import shutil
import time
from typing import Any

from strategies.base import FetchResult, FetchStrategy

# Lazy imports — only load selenium when actually used
_driver = None


def _find_chrome_binary() -> str | None:
    """Find a Chrome/Chromium binary on the system.

    Checks (in order):
    1. Playwright-installed Chromium (common in Codespaces/CI)
    2. System Chrome/Chromium
    3. webdriver-manager managed Chrome
    """
    # Playwright cache
    playwright_paths = glob.glob(
        os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome")
    )
    if playwright_paths:
        return sorted(playwright_paths)[-1]  # latest version

    # System binaries
    for name in [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]:
        path = shutil.which(name)
        if path:
            return path

    return None


def _get_driver(headless: bool = True, timeout: int = 15) -> Any:
    """Lazily initialize and reuse a single Chrome WebDriver."""
    global _driver
    if _driver is not None:
        return _driver

    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

    chrome_binary = _find_chrome_binary()
    if chrome_binary is None:
        raise RuntimeError("No Chrome/Chromium binary found")

    options = Options()
    options.binary_location = chrome_binary
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_argument(
        "user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )

    # Try webdriver-manager first, fall back to letting Selenium find chromedriver
    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = Service(ChromeDriverManager().install())
    except Exception:
        service = Service()

    _driver = webdriver.Chrome(service=service, options=options)
    _driver.set_page_load_timeout(timeout)
    _driver.implicitly_wait(timeout)
    return _driver


class SeleniumStrategy(FetchStrategy):
    """Fetch pages using a headless Chrome browser."""

    name = "selenium"

    def __init__(
        self, headless: bool = True, timeout: int = 15, wait_seconds: float = 2.0
    ) -> None:
        self.headless = headless
        self.timeout = timeout
        self.wait_seconds = wait_seconds

    def is_available(self) -> bool:
        """Check if selenium is importable and a browser binary exists."""
        try:
            import selenium  # noqa: F401

            return _find_chrome_binary() is not None
        except ImportError:
            return False

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Load page in Chrome and return rendered HTML."""
        driver = _get_driver(headless=self.headless, timeout=self.timeout)
        driver.get(url)
        # Wait for JS to render
        time.sleep(self.wait_seconds)
        html = driver.page_source
        return FetchResult(
            content=html,
            content_type="html",
            status_code=200,
            strategy_name=self.name,
        )

    def cleanup(self) -> None:
        """Quit the browser."""
        global _driver
        if _driver is not None:
            try:
                _driver.quit()
            except Exception:
                pass
            _driver = None
