"""Load the canonical AI vocabulary (tags, red flags, severities).

Single source of truth lives at `scraper/ai_vocab.json`. The TS types under
`frontend/src/types/ai-vocab.generated.ts` are emitted from the same file
by `scraper/emit_ts_vocab.py` — do NOT edit the generated .ts directly.

See ADR-012 for the why.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_VOCAB_PATH = Path(__file__).parent / "ai_vocab.json"


@lru_cache(maxsize=1)
def _load() -> dict:
    with _VOCAB_PATH.open() as fh:
        return json.load(fh)


def ai_tags() -> list[str]:
    """Allowed aiTag keys. Order matches ai_vocab.json (stable for UI)."""
    return [entry["key"] for entry in _load()["aiTags"]]


def red_flags() -> list[str]:
    """Allowed redFlag keys."""
    return [entry["key"] for entry in _load()["redFlags"]]


def tag_labels() -> dict[str, str]:
    """aiTag key → display label."""
    return {entry["key"]: entry["label"] for entry in _load()["aiTags"]}


def flag_labels() -> dict[str, str]:
    """redFlag key → display label."""
    return {entry["key"]: entry["label"] for entry in _load()["redFlags"]}


def flag_severities() -> dict[str, int]:
    """redFlag key → severity (1-5, higher = worse). Used by curate.py for weighted penalties."""
    return {entry["key"]: int(entry["severity"]) for entry in _load()["redFlags"]}
