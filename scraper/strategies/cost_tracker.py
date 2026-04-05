"""Tracks API spending across Firecrawl and Claude, enforces daily limits."""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from config import DATA_DIR

COST_LOG_PATH = DATA_DIR / "ai_costs.json"


def _load_log() -> dict[str, Any]:
    """Load or initialize the cost log."""
    if COST_LOG_PATH.exists():
        try:
            return json.loads(COST_LOG_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"total_spent_usd": 0.0, "days": {}, "model_stats": {}, "source_stats": {}}


def _save_log(log: dict[str, Any]) -> None:
    """Persist the cost log."""
    COST_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    COST_LOG_PATH.write_text(json.dumps(log, indent=2))


def _today() -> str:
    return date.today().isoformat()


def get_daily_spend() -> float:
    """Get total USD spent today."""
    log = _load_log()
    day = log.get("days", {}).get(_today(), {})
    return day.get("total_cost_usd", 0.0)


def can_spend(amount_usd: float, daily_limit: float = 1.0) -> bool:
    """Check if we can spend this amount without exceeding the daily limit."""
    return get_daily_spend() + amount_usd <= daily_limit


def record_call(
    source: str,
    task: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    success: bool,
) -> None:
    """Record an API call in the cost log."""
    log = _load_log()
    today = _today()

    # Daily tracking
    if today not in log.setdefault("days", {}):
        log["days"][today] = {"calls": [], "total_cost_usd": 0.0}
    day = log["days"][today]
    day["calls"].append(
        {
            "source": source,
            "task": task,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
            "success": success,
        }
    )
    day["total_cost_usd"] = round(day["total_cost_usd"] + cost_usd, 6)

    # Lifetime total
    log["total_spent_usd"] = round(log.get("total_spent_usd", 0.0) + cost_usd, 6)

    # Per-model stats
    model_stats = log.setdefault("model_stats", {})
    if model not in model_stats:
        model_stats[model] = {"calls": 0, "successes": 0, "total_cost": 0.0}
    model_stats[model]["calls"] += 1
    if success:
        model_stats[model]["successes"] += 1
    model_stats[model]["total_cost"] = round(
        model_stats[model]["total_cost"] + cost_usd, 6
    )

    # Per-source stats
    source_stats = log.setdefault("source_stats", {})
    if source not in source_stats:
        source_stats[source] = {"ai_calls": 0, "learned_selector_hits": 0}
    source_stats[source]["ai_calls"] += 1
    source_stats[source]["last_ai_call"] = today

    _save_log(log)


def record_selector_hit(source: str) -> None:
    """Record that a learned selector was used successfully (no AI cost)."""
    log = _load_log()
    source_stats = log.setdefault("source_stats", {})
    if source not in source_stats:
        source_stats[source] = {"ai_calls": 0, "learned_selector_hits": 0}
    source_stats[source]["learned_selector_hits"] += 1
    _save_log(log)


def get_summary() -> dict[str, Any]:
    """Return a summary of spending for logging."""
    log = _load_log()
    today = _today()
    day = log.get("days", {}).get(today, {})
    return {
        "today_spend": day.get("total_cost_usd", 0.0),
        "today_calls": len(day.get("calls", [])),
        "lifetime_spend": log.get("total_spent_usd", 0.0),
        "model_stats": log.get("model_stats", {}),
    }
