"""Formatting utilities shared between scraper and notifier."""

from __future__ import annotations


def format_price(price: float) -> str:
    if price >= 1_000_000:
        return f"${price / 1_000_000:.1f}M"
    if price >= 1_000:
        return f"${price / 1_000:.0f}k"
    return f"${price:,.0f}"


def format_price_per_acre(price_per_acre: float) -> str:
    return f"${round(price_per_acre):,}/ac"


def format_acreage(acreage: float) -> str:
    if acreage >= 1000:
        return f"{acreage / 1000:.1f}k acres"
    return f"{acreage:.0f} acres"
