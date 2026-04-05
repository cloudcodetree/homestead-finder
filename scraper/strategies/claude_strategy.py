"""Tier 4/5: Claude AI extraction strategy — send content to Claude for structured parsing."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from strategies.base import FetchResult, FetchStrategy

# Prompt for direct listing extraction from page content
EXTRACTION_PROMPT = """Extract all land/property listings from this page content.

For each listing return a JSON object with these exact fields:
- "title": listing title (string)
- "price": price in USD as a number (0 if not found)
- "acreage": acreage as a number (0 if not found)
- "state": two-letter state code
- "county": county name if visible, else ""
- "url": full listing URL if visible, else ""
- "description": brief description, max 500 chars
- "external_id": any unique ID from the source, else ""

Return ONLY a JSON array of objects. No explanation, no markdown fences.

Source: {source_name}
Target state: {state}
"""


def _strip_html_noise(html: str) -> str:
    """Remove script/style/svg tags and limit size for token efficiency."""
    html = re.sub(
        r"<(script|style|svg|noscript)[^>]*>.*?</\1>",
        "",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    # Limit to ~100KB to stay within token budgets
    if len(html) > 100_000:
        html = html[:100_000]
    return html


class ClaudeExtractionStrategy(FetchStrategy):
    """Use Claude to extract structured listing data from HTML or markdown.

    Unlike other strategies, this doesn't fetch a URL — it takes existing
    page content and extracts structured data. It's used as the last tier
    in a chain, typically after Firecrawl has fetched markdown.
    """

    name = "claude"

    def __init__(
        self,
        source_name: str = "",
        state: str = "",
        model: str = "claude-haiku-4-5-20251001",
    ) -> None:
        self.source_name = source_name
        self.state = state
        self.model = model
        self._client: Any = None

    def _get_client(self) -> Any:
        """Lazily initialize the Anthropic client."""
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        return self._client

    def is_available(self) -> bool:
        """Check for anthropic package and API key."""
        if not os.getenv("ANTHROPIC_API_KEY"):
            return False
        try:
            import anthropic  # noqa: F401

            return True
        except ImportError:
            return False

    def extract_listings(
        self, content: str, content_type: str = "html"
    ) -> list[dict[str, Any]]:
        """Send content to Claude and get structured listing data back."""
        client = self._get_client()

        if content_type == "html":
            content = _strip_html_noise(content)

        prompt = EXTRACTION_PROMPT.format(
            source_name=self.source_name,
            state=self.state,
        )

        response = client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[
                {"role": "user", "content": f"{prompt}\n\nPage content:\n{content}"}
            ],
        )

        text = response.content[0].text.strip()
        # Parse JSON — handle potential markdown fences
        if text.startswith("```"):
            text = re.sub(r"^```\w*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
            text = text.strip()

        listings = json.loads(text)
        if not isinstance(listings, list):
            listings = [listings]
        return listings

    def fetch(self, url: str, **kwargs: Any) -> FetchResult:
        """Not a traditional fetcher — use extract_listings() instead.

        This fetch() is provided for chain compatibility. It expects
        pre-fetched content in kwargs['content'].
        """
        content = kwargs.get("content", "")
        content_type = kwargs.get("content_type", "html")
        if not content:
            raise ValueError(
                "ClaudeExtractionStrategy.fetch() requires content in kwargs"
            )
        listings = self.extract_listings(content, content_type)
        return FetchResult(
            content=json.dumps(listings),
            content_type="json",
            status_code=200,
            strategy_name=self.name,
            cost=0.01,  # rough estimate, tracked more precisely by cost_tracker
        )
