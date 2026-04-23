"""Tests for the shared politeness layer (scraper/throttle.py).

Focus areas:
  * per-domain bucket enforces crawl delay
  * robots.txt disallow raises RobotsDisallowed
  * 429 trips exponential backoff
  * daily quota ceiling raises DailyQuotaExceeded
  * quota persistence roundtrips through the JSON file

Tests use a private quota file per test to avoid polluting real data/.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

import throttle


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Fresh throttle state + per-test quota file + no real robots fetch."""
    throttle._reset_for_tests()
    throttle.set_quota_file(tmp_path / "quota.json")
    # Replace robots loader with a stub that allows everything. Tests
    # that care about robots explicitly override `state.robots`.
    real_ensure = throttle._ensure_robots

    def fake_ensure(url, state):
        if state.robots is None:
            import urllib.robotparser

            rp = urllib.robotparser.RobotFileParser()
            rp.parse([])  # empty = allow all
            state.robots = rp
            state.robots_fetched_at = time.monotonic()

    monkeypatch.setattr(throttle, "_ensure_robots", fake_ensure)
    yield
    throttle._reset_for_tests()


def test_acquire_enforces_crawl_delay(monkeypatch):
    """Second acquire within the crawl-delay window must sleep."""
    sleeps: list[float] = []
    monkeypatch.setattr(throttle.time, "sleep", lambda s: sleeps.append(s))
    state = throttle.get_state("https://example.com/")
    state.crawl_delay = 2.0

    throttle.acquire("https://example.com/a")
    throttle.acquire("https://example.com/b")

    # Second call should have slept ~2s + jitter
    assert any(s > 1.5 for s in sleeps), f"expected delay sleep, got {sleeps}"


def test_crawl_delay_is_per_domain(monkeypatch):
    """Two hits on DIFFERENT domains don't block each other."""
    sleeps: list[float] = []
    monkeypatch.setattr(throttle.time, "sleep", lambda s: sleeps.append(s))

    throttle.acquire("https://alpha.example/page1")
    throttle.acquire("https://beta.example/page1")

    # Neither call should have needed to sleep for crawl delay.
    assert all(s < 0.6 for s in sleeps), (
        f"no cross-domain blocking expected; sleeps={sleeps}"
    )


def test_robots_disallow_raises():
    """RobotsDisallowed when the site forbids the path."""
    import urllib.robotparser

    state = throttle.get_state("https://forbidden.example/")
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(["User-agent: *", "Disallow: /secret"])
    state.robots = rp
    state.robots_fetched_at = time.monotonic()

    with pytest.raises(throttle.RobotsDisallowed):
        throttle.acquire("https://forbidden.example/secret/page")

    # Unlisted path still allowed
    throttle.acquire("https://forbidden.example/public")


def test_release_on_429_sets_backoff():
    url = "https://slow.example/hit"
    throttle.acquire(url)
    throttle.release(url, 429, retry_after=3.0)
    state = throttle.get_state(url)
    assert state.consecutive_failures == 1
    assert state.backoff_until > time.monotonic()


def test_successive_429s_escalate_backoff():
    url = "https://slow2.example/hit"
    throttle.acquire(url)
    throttle.release(url, 429)
    first_wait = throttle.get_state(url).backoff_until - time.monotonic()
    throttle.release(url, 429)
    second_wait = throttle.get_state(url).backoff_until - time.monotonic()
    throttle.release(url, 429)
    third_wait = throttle.get_state(url).backoff_until - time.monotonic()
    assert first_wait < second_wait < third_wait, (
        first_wait,
        second_wait,
        third_wait,
    )


def test_success_clears_failure_streak():
    url = "https://recovers.example/hit"
    throttle.acquire(url)
    throttle.release(url, 429)
    assert throttle.get_state(url).consecutive_failures == 1
    throttle.release(url, 200)
    state = throttle.get_state(url)
    assert state.consecutive_failures == 0
    assert state.backoff_until == 0.0


def test_daily_quota_ceiling(monkeypatch):
    """DailyQuotaExceeded raises once the ceiling is hit."""
    monkeypatch.setattr(throttle, "_DEFAULT_MAX_PER_DAY", 3)
    url = "https://capped.example/a"
    for _ in range(3):
        throttle.acquire(url)
    with pytest.raises(throttle.DailyQuotaExceeded):
        throttle.acquire(url)


def test_quota_persists_across_state_reset(tmp_path, monkeypatch):
    """Counter from disk should survive an in-memory reset (simulates
    process restart within the same day)."""
    monkeypatch.setattr(throttle, "_DEFAULT_MAX_PER_DAY", 5)
    quota_file = tmp_path / "persist.json"
    throttle.set_quota_file(quota_file)
    url = "https://persist.example/"

    # First "process" — 2 requests
    throttle.acquire(url)
    throttle.acquire(url)

    # Verify file was written
    assert quota_file.exists()
    data = json.loads(quota_file.read_text())
    assert data["persist.example"]["count"] == 2

    # "Restart" — reset in-memory state, re-acquire. Should see 3 total.
    throttle._reset_for_tests()
    throttle.set_quota_file(quota_file)  # _reset doesn't touch this
    throttle.acquire(url)
    data = json.loads(quota_file.read_text())
    assert data["persist.example"]["count"] == 3


def test_can_fetch_allows_by_default():
    """can_fetch fails open when robots.txt is empty / unreachable."""
    assert throttle.can_fetch("https://anyhost.example/any/path") is True
