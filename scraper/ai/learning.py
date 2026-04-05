"""AI learning pipeline: detect parse failure → try learned selectors → discover new ones."""

from __future__ import annotations

import re
from typing import Any

from ai.models import ModelEscalator
from ai.prompts import build_extraction_prompt, build_selector_discovery_prompt
from ai.selectors import (
    apply_selectors,
    bump_validation,
    load_selectors,
    save_selectors,
)
from config import AI_MAX_SPEND_PER_RUN
from logger import get_logger
from strategies.cost_tracker import can_spend, record_selector_hit

log = get_logger("ai.learning")


def _strip_html_noise(html: str) -> str:
    """Remove script/style/svg tags and limit size for token efficiency."""
    html = re.sub(
        r"<(script|style|svg|noscript)[^>]*>.*?</\1>",
        "",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    if len(html) > 100_000:
        html = html[:100_000]
    return html


def _validate_listings(result: Any) -> bool:
    """Validate that AI extraction returned usable listings."""
    if not isinstance(result, list):
        return False
    if len(result) == 0:
        return False
    # Check at least one listing has title and price or acreage
    for item in result:
        if not isinstance(item, dict):
            return False
        title = item.get("title", "")
        price = item.get("price", 0)
        acreage = item.get("acreage", 0)
        if title and (price > 0 or acreage > 0):
            return True
    return False


def _validate_selectors(result: Any) -> bool:
    """Validate that selector discovery returned usable selectors."""
    if not isinstance(result, dict):
        return False
    selectors = result.get("selectors", {})
    if not selectors.get("listing_container"):
        return False
    if not selectors.get("title"):
        return False
    confidence = result.get("confidence", 0)
    return confidence >= 0.5


class AILearningPipeline:
    """Orchestrates the AI fallback: learned selectors → discovery → extraction."""

    def __init__(self, source_name: str) -> None:
        self.source_name = source_name
        self.escalator = ModelEscalator(source_name, daily_budget=AI_MAX_SPEND_PER_RUN)

    def extract_from_content(
        self,
        content: str,
        content_type: str,
        state: str,
        url: str,
    ) -> list[dict[str, Any]]:
        """Try to extract listings from page content using the learning pipeline.

        Order of attempts:
        1. Apply learned selectors (free — cached from prior AI runs)
        2. Discover new selectors via AI and cache them (paid, but saves money long-term)
        3. Direct AI extraction without selectors (paid, per-page)
        """
        # Step 1: Try learned selectors (HTML only)
        if content_type == "html":
            results = self._try_learned_selectors(content, state)
            if results:
                return results

        # Step 2: Try selector discovery (HTML only)
        if content_type == "html":
            results = self._try_selector_discovery(content, state, url)
            if results:
                return results

        # Step 3: Direct AI extraction (works on both HTML and markdown)
        return self._try_direct_extraction(content, content_type, state)

    def _try_learned_selectors(self, html: str, state: str) -> list[dict[str, Any]]:
        """Attempt to use previously learned selectors."""
        selector_config = load_selectors(self.source_name)
        if selector_config is None:
            return []

        log.info(
            f"[ai] Trying learned selectors v{selector_config.get('version', '?')} for {self.source_name}"
        )
        results = apply_selectors(html, selector_config)

        if results:
            log.info(f"[ai] Learned selectors extracted {len(results)} listings")
            bump_validation(self.source_name)
            record_selector_hit(self.source_name)
            # Add state to results
            for r in results:
                r.setdefault("state", state)
            return results

        log.info("[ai] Learned selectors returned 0 results — will rediscover")
        return []

    def _try_selector_discovery(
        self, html: str, state: str, url: str
    ) -> list[dict[str, Any]]:
        """Use AI to discover new CSS selectors for this source."""
        if not can_spend(0.10, AI_MAX_SPEND_PER_RUN):
            log.info("[ai] Budget too low for selector discovery")
            return []

        old_selectors = load_selectors(self.source_name)
        old_sel_dict = old_selectors.get("selectors") if old_selectors else None

        prompt = build_selector_discovery_prompt(
            source_name=self.source_name,
            url=url,
            previous_selectors=old_sel_dict,
        )

        cleaned_html = _strip_html_noise(html)
        result, model_name = self.escalator.execute(
            task_type="discover_selectors",
            prompt=prompt,
            content=cleaned_html,
            validator=_validate_selectors,
        )

        if result is None:
            return []

        # Save the discovered selectors for future runs
        confidence = result.get("confidence", 0.0)
        save_selectors(
            source_name=self.source_name,
            selectors=result.get("selectors", {}),
            field_extraction=result.get("field_extraction", {}),
            confidence=confidence,
            discovery_model=model_name or "unknown",
        )

        # Try applying the new selectors immediately
        new_config = {
            "selectors": result.get("selectors", {}),
            "field_extraction": result.get("field_extraction", {}),
        }
        listings = apply_selectors(html, new_config)

        if listings:
            log.info(f"[ai] New selectors extracted {len(listings)} listings")
            for item in listings:
                item.setdefault("state", state)
            return listings

        # If selectors didn't work on the page, fall back to sample_listings from AI
        sample = result.get("sample_listings", [])
        if sample:
            log.info(
                f"[ai] Using {len(sample)} sample listings from selector discovery"
            )
            for item in sample:
                if isinstance(item, dict):
                    item.setdefault("state", state)
            return [s for s in sample if isinstance(s, dict)]

        return []

    def _try_direct_extraction(
        self,
        content: str,
        content_type: str,
        state: str,
    ) -> list[dict[str, Any]]:
        """Direct AI extraction without selectors — most expensive option."""
        if not can_spend(0.02, AI_MAX_SPEND_PER_RUN):
            log.info("[ai] Budget too low for direct extraction")
            return []

        prompt = build_extraction_prompt(
            source_name=self.source_name,
            state=state,
        )

        if content_type == "html":
            content = _strip_html_noise(content)

        result, model_name = self.escalator.execute(
            task_type="extract_listings",
            prompt=prompt,
            content=content,
            validator=_validate_listings,
        )

        if result is None:
            return []

        # Add state to results
        for item in result:
            if isinstance(item, dict):
                item.setdefault("state", state)

        log.info(f"[ai] Direct extraction got {len(result)} listings via {model_name}")
        return result
