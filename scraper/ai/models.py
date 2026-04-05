"""Model escalation: try cheapest model first, escalate on failure."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

from ai.config import TASK_MODEL_DEFAULTS, get_model_by_tier, estimate_cost
from logger import get_logger
from strategies.cost_tracker import can_spend, record_call

log = get_logger("ai.models")

# Lazy-loaded Anthropic client
_client = None


def _get_client() -> Any:
    """Get or create the Anthropic client."""
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _parse_json_response(text: str) -> Any:
    """Parse JSON from Claude's response, handling markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()
    return json.loads(text)


class ModelEscalator:
    """Execute AI tasks with automatic model escalation."""

    def __init__(self, source_name: str, daily_budget: float = 1.0) -> None:
        self.source_name = source_name
        self.daily_budget = daily_budget

    def execute(
        self,
        task_type: str,
        prompt: str,
        content: str,
        validator: Callable[[Any], bool],
    ) -> tuple[Any, str | None]:
        """Run a task, escalating through model tiers on failure.

        Returns (result, model_name) on success, or (None, None) if all tiers fail.
        """
        task_config = TASK_MODEL_DEFAULTS.get(task_type)
        if task_config is None:
            raise ValueError(f"Unknown task type: {task_type}")

        start_tier = task_config["start_tier"]
        max_tier = task_config["max_tier"]

        for tier in range(start_tier, max_tier + 1):
            model_config = get_model_by_tier(tier)
            model_id = model_config["model_id"]
            model_name = model_config["name"]

            # Check budget before calling
            estimated_cost = estimate_cost(model_name, 10000, 2000)  # rough estimate
            if not can_spend(estimated_cost, self.daily_budget):
                log.info(f"[ai] Budget exhausted, skipping {model_name}")
                continue

            try:
                client = _get_client()
                response = client.messages.create(
                    model=model_id,
                    max_tokens=model_config["max_output_tokens"],
                    messages=[
                        {
                            "role": "user",
                            "content": f"{prompt}\n\nPage content:\n{content}",
                        }
                    ],
                )

                text = response.content[0].text
                input_tokens = response.usage.input_tokens
                output_tokens = response.usage.output_tokens
                actual_cost = estimate_cost(model_name, input_tokens, output_tokens)

                result = _parse_json_response(text)

                if validator(result):
                    record_call(
                        source=self.source_name,
                        task=task_type,
                        model=model_name,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost_usd=actual_cost,
                        success=True,
                    )
                    log.info(
                        f"[ai] {task_type} succeeded with {model_name} (${actual_cost:.4f})"
                    )
                    return result, model_name
                else:
                    record_call(
                        source=self.source_name,
                        task=task_type,
                        model=model_name,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost_usd=actual_cost,
                        success=False,
                    )
                    log.info(
                        f"[ai] {task_type} with {model_name}: validation failed, escalating"
                    )

            except Exception as e:
                log.info(f"[ai] {task_type} with {model_name} error: {e}")
                # Record the failed attempt with zero tokens if we couldn't get usage
                record_call(
                    source=self.source_name,
                    task=task_type,
                    model=model_name,
                    input_tokens=0,
                    output_tokens=0,
                    cost_usd=0.0,
                    success=False,
                )

        return None, None
