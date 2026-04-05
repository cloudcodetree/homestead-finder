"""Adaptive fetch strategies with automatic fallback."""

from __future__ import annotations

from strategies.base import (
    FetchResult,
    FetchStrategy,
    FetchStrategyChain,
    AllStrategiesFailed,
)
from strategies.http import SimpleHTTPStrategy

__all__ = [
    "FetchResult",
    "FetchStrategy",
    "FetchStrategyChain",
    "AllStrategiesFailed",
    "SimpleHTTPStrategy",
]
