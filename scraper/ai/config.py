"""AI-specific configuration: model tiers, task mappings, cost limits."""

from __future__ import annotations

# ── Model tiers (cheapest to most expensive) ─────────────────────────────────
MODEL_TIERS = [
    {
        "name": "haiku",
        "model_id": "claude-haiku-4-5-20251001",
        "input_cost_per_mtok": 0.80,
        "output_cost_per_mtok": 4.00,
        "max_output_tokens": 4096,
        "tier": 1,
    },
    {
        "name": "sonnet",
        "model_id": "claude-sonnet-4-6",
        "input_cost_per_mtok": 3.00,
        "output_cost_per_mtok": 15.00,
        "max_output_tokens": 8192,
        "tier": 2,
    },
    {
        "name": "opus",
        "model_id": "claude-opus-4-6",
        "input_cost_per_mtok": 15.00,
        "output_cost_per_mtok": 75.00,
        "max_output_tokens": 8192,
        "tier": 3,
    },
]

# ── Task-to-model mapping ────────────────────────────────────────────────────
# Each task starts at a model tier and can escalate up to max_tier on failure.
TASK_MODEL_DEFAULTS = {
    "extract_listings": {
        "start_tier": 1,  # Haiku — clean markdown to structured JSON
        "max_tier": 2,  # Escalate to Sonnet if Haiku fails
    },
    "discover_selectors": {
        "start_tier": 2,  # Sonnet — needs HTML structure analysis
        "max_tier": 3,  # Can escalate to Opus for complex structures
    },
    "validate_data": {
        "start_tier": 1,  # Haiku — simple schema check
        "max_tier": 1,  # Never escalate
    },
}


def get_model_by_tier(tier: int) -> dict:
    """Get model config for a given tier number."""
    for model in MODEL_TIERS:
        if model["tier"] == tier:
            return model
    raise ValueError(f"No model defined for tier {tier}")


def estimate_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a given model and token count."""
    for model in MODEL_TIERS:
        if model["name"] == model_name:
            input_cost = (input_tokens / 1_000_000) * model["input_cost_per_mtok"]
            output_cost = (output_tokens / 1_000_000) * model["output_cost_per_mtok"]
            return round(input_cost + output_cost, 6)
    return 0.0
