"""Tests for the fetch strategy chain and AI learning pipeline."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure scraper root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import (
    FetchResult,
    FetchStrategy,
    FetchStrategyChain,
    AllStrategiesFailed,
)


# ── FetchStrategyChain tests ─────────────────────────────────────────────────


class FakeStrategy(FetchStrategy):
    """Test strategy that can be configured to succeed or fail."""

    def __init__(
        self, name: str, should_fail: bool = False, result: FetchResult | None = None
    ) -> None:
        self.name = name
        self.should_fail = should_fail
        self._result = result or FetchResult(
            content="<html>ok</html>", content_type="html"
        )
        self.call_count = 0
        self._available = True

    def fetch(self, url: str, **kwargs) -> FetchResult:
        self.call_count += 1
        if self.should_fail:
            raise ConnectionError(f"{self.name} failed")
        return self._result

    def is_available(self) -> bool:
        return self._available


class TestFetchStrategyChain:
    def test_returns_first_success(self):
        s1 = FakeStrategy(
            "s1", result=FetchResult(content="first", content_type="html")
        )
        s2 = FakeStrategy(
            "s2", result=FetchResult(content="second", content_type="html")
        )
        chain = FetchStrategyChain([s1, s2])

        result = chain.fetch("http://example.com")
        assert result.content == "first"
        assert result.strategy_name == "s1"
        assert s1.call_count == 1
        assert s2.call_count == 0  # Not called because s1 succeeded

    def test_falls_back_on_failure(self):
        s1 = FakeStrategy("s1", should_fail=True)
        s2 = FakeStrategy(
            "s2", result=FetchResult(content="fallback", content_type="html")
        )
        chain = FetchStrategyChain([s1, s2])

        result = chain.fetch("http://example.com")
        assert result.content == "fallback"
        assert result.strategy_name == "s2"
        assert s1.call_count == 1
        assert s2.call_count == 1

    def test_raises_when_all_fail(self):
        s1 = FakeStrategy("s1", should_fail=True)
        s2 = FakeStrategy("s2", should_fail=True)
        chain = FetchStrategyChain([s1, s2])

        with pytest.raises(AllStrategiesFailed) as exc_info:
            chain.fetch("http://example.com")
        assert len(exc_info.value.errors) == 2
        assert exc_info.value.errors[0][0] == "s1"
        assert exc_info.value.errors[1][0] == "s2"

    def test_skips_unavailable_strategies(self):
        s1 = FakeStrategy("s1")
        s1._available = False
        s2 = FakeStrategy(
            "s2", result=FetchResult(content="available", content_type="html")
        )
        chain = FetchStrategyChain([s1, s2])

        result = chain.fetch("http://example.com")
        assert result.content == "available"
        assert s1.call_count == 0  # Skipped

    def test_empty_chain_raises(self):
        chain = FetchStrategyChain([])
        with pytest.raises(AllStrategiesFailed):
            chain.fetch("http://example.com")

    def test_strategy_name_set_on_result(self):
        s1 = FakeStrategy(
            "my_strategy", result=FetchResult(content="x", content_type="html")
        )
        chain = FetchStrategyChain([s1])

        result = chain.fetch("http://example.com")
        assert result.strategy_name == "my_strategy"

    def test_cleanup_calls_all(self):
        s1 = FakeStrategy("s1")
        s2 = FakeStrategy("s2")
        s1.cleanup = MagicMock()
        s2.cleanup = MagicMock()
        chain = FetchStrategyChain([s1, s2])

        chain.cleanup()
        s1.cleanup.assert_called_once()
        s2.cleanup.assert_called_once()


# ── Cost tracker tests ───────────────────────────────────────────────────────


class TestCostTracker:
    def test_record_and_get_daily_spend(self, tmp_path):
        with patch("strategies.cost_tracker.COST_LOG_PATH", tmp_path / "costs.json"):
            from strategies.cost_tracker import record_call, get_daily_spend

            assert get_daily_spend() == 0.0
            record_call("landwatch", "extract", "haiku", 1000, 500, 0.05, True)
            assert get_daily_spend() == 0.05
            record_call("landwatch", "extract", "haiku", 1000, 500, 0.03, True)
            assert get_daily_spend() == 0.08

    def test_can_spend_checks_budget(self, tmp_path):
        with patch("strategies.cost_tracker.COST_LOG_PATH", tmp_path / "costs.json"):
            from strategies.cost_tracker import can_spend, record_call

            assert can_spend(0.50, daily_limit=1.0)
            record_call("test", "test", "haiku", 0, 0, 0.80, True)
            assert can_spend(0.19, daily_limit=1.0)
            assert not can_spend(0.21, daily_limit=1.0)

    def test_get_summary(self, tmp_path):
        with patch("strategies.cost_tracker.COST_LOG_PATH", tmp_path / "costs.json"):
            from strategies.cost_tracker import record_call, get_summary

            record_call("test", "extract", "haiku", 1000, 500, 0.01, True)
            summary = get_summary()
            assert summary["today_calls"] == 1
            assert summary["today_spend"] == 0.01
            assert summary["lifetime_spend"] == 0.01


# ── Learned selectors tests ─────────────────────────────────────────────────


class TestLearnedSelectors:
    def test_save_and_load(self, tmp_path):
        with patch("ai.selectors.LEARNED_SELECTORS_DIR", tmp_path):
            from ai.selectors import save_selectors, load_selectors

            save_selectors(
                source_name="test_source",
                selectors={"listing_container": "div.card", "title": "h3"},
                field_extraction={"price_regex": r"[\d,]+"},
                confidence=0.85,
                discovery_model="sonnet",
            )

            loaded = load_selectors("test_source")
            assert loaded is not None
            assert loaded["source"] == "test_source"
            assert loaded["version"] == 1
            assert loaded["selectors"]["listing_container"] == "div.card"
            assert loaded["confidence"] == 0.85

    def test_version_increments(self, tmp_path):
        with patch("ai.selectors.LEARNED_SELECTORS_DIR", tmp_path):
            from ai.selectors import save_selectors, load_selectors

            save_selectors("src", {"listing_container": "a"}, {}, 0.8, "haiku")
            save_selectors("src", {"listing_container": "b"}, {}, 0.9, "sonnet")

            loaded = load_selectors("src")
            assert loaded["version"] == 2
            assert loaded["selectors"]["listing_container"] == "b"

    def test_load_nonexistent_returns_none(self, tmp_path):
        with patch("ai.selectors.LEARNED_SELECTORS_DIR", tmp_path):
            from ai.selectors import load_selectors

            assert load_selectors("nonexistent") is None

    def test_apply_selectors_to_html(self):
        from ai.selectors import apply_selectors

        html = """
        <div class="results">
          <div class="card">
            <h3 class="title">40 Acres in Montana</h3>
            <span class="price">$85,000</span>
            <span class="acres">40 acres</span>
            <a href="/listing/12345">View</a>
          </div>
          <div class="card">
            <h3 class="title">20 Acres in Idaho</h3>
            <span class="price">$42,000</span>
            <span class="acres">20 acres</span>
            <a href="/listing/67890">View</a>
          </div>
        </div>
        """
        config = {
            "selectors": {
                "listing_container": "div.card",
                "title": "h3.title",
                "price": "span.price",
                "acreage": "span.acres",
                "link": "a[href]",
            },
            "field_extraction": {
                "price_regex": r"[\d,]+\.?\d*",
                "acreage_regex": r"([\d,]+\.?\d*)\s*acres?",
                "id_from_url_regex": r"/(\d+)$",
            },
        }

        results = apply_selectors(html, config)
        assert len(results) == 2
        assert results[0]["title"] == "40 Acres in Montana"
        assert results[0]["price"] == 85000.0
        assert results[0]["acreage"] == 40.0
        assert results[0]["external_id"] == "12345"
        assert results[1]["price"] == 42000.0

    def test_apply_selectors_empty_container_returns_empty(self):
        from ai.selectors import apply_selectors

        config = {
            "selectors": {"listing_container": "div.nonexistent"},
            "field_extraction": {},
        }
        assert apply_selectors("<div>nothing</div>", config) == []


# ── Model escalation tests ──────────────────────────────────────────────────


class TestModelConfig:
    def test_get_model_by_tier(self):
        from ai.config import get_model_by_tier

        haiku = get_model_by_tier(1)
        assert haiku["name"] == "haiku"
        sonnet = get_model_by_tier(2)
        assert sonnet["name"] == "sonnet"
        opus = get_model_by_tier(3)
        assert opus["name"] == "opus"

    def test_invalid_tier_raises(self):
        from ai.config import get_model_by_tier

        with pytest.raises(ValueError):
            get_model_by_tier(99)

    def test_estimate_cost(self):
        from ai.config import estimate_cost

        cost = estimate_cost("haiku", 10000, 2000)
        # Haiku: 10K input * $0.80/MTok + 2K output * $4.00/MTok
        expected = (10000 / 1_000_000) * 0.80 + (2000 / 1_000_000) * 4.00
        assert abs(cost - expected) < 0.0001
