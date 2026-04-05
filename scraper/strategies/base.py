"""Base classes for the fetch strategy chain."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from logger import get_logger

log = get_logger("strategies")


@dataclass
class FetchResult:
    """Result from a successful fetch strategy."""

    content: str
    content_type: str  # "html" or "markdown"
    status_code: int = 200
    strategy_name: str = ""
    cost: float = 0.0


class AllStrategiesFailed(Exception):
    """Raised when every strategy in the chain has failed."""

    def __init__(self, errors: list[tuple[str, Exception]]) -> None:
        self.errors = errors
        details = "; ".join(f"{name}: {err}" for name, err in errors)
        super().__init__(f"All strategies failed — {details}")


class FetchStrategy(ABC):
    """Abstract base for a single fetch strategy."""

    name: str = "base"

    @abstractmethod
    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Fetch content from a URL. Raises on failure."""
        ...

    def is_available(self) -> bool:
        """Check if this strategy can run (dependencies, API keys, etc.)."""
        return True

    def cleanup(self) -> None:
        """Release resources (browser sessions, etc.). Called at end of scrape run."""
        pass


class FetchStrategyChain:
    """Tries strategies in order until one succeeds."""

    def __init__(self, strategies: list[FetchStrategy]) -> None:
        self.strategies = strategies

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Try each strategy in order. Return first success, or raise AllStrategiesFailed."""
        errors: list[tuple[str, Exception]] = []

        for strategy in self.strategies:
            if not strategy.is_available():
                log.debug("strategy=%s status=unavailable url=%s", strategy.name, url)
                errors.append((strategy.name, RuntimeError("not available")))
                continue
            try:
                log.debug("strategy=%s status=trying url=%s", strategy.name, url)
                result = strategy.fetch(url, **kwargs)
                result.strategy_name = strategy.name
                log.info(
                    "strategy=%s status=success url=%s content_type=%s",
                    strategy.name,
                    url,
                    result.content_type,
                )
                return result
            except Exception as e:
                log.info(
                    "strategy=%s status=failed url=%s error=%s", strategy.name, url, e
                )
                errors.append((strategy.name, e))

        raise AllStrategiesFailed(errors)

    def cleanup(self) -> None:
        """Clean up all strategies."""
        for strategy in self.strategies:
            try:
                strategy.cleanup()
            except Exception:
                pass
