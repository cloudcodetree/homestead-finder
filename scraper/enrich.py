"""Enrich listings with AI-derived tags, fit score, red flags, and a summary.

Runs LOCALLY on the developer's machine (not in CI). Uses Claude via the
`claude -p` subprocess wrapper in `llm.py`, so calls are billed against the
Max subscription quota rather than API credits.

Usage:
    python -m scraper.enrich                       # enrich all listings
    python -m scraper.enrich --input data/listings.json --output data/listings.json
    python -m scraper.enrich --limit 5             # test with a handful
    python -m scraper.enrich --force               # re-enrich everything
    python -m scraper.enrich --model sonnet        # bump model for quality

The script is idempotent: each listing's enrichment is keyed by a content
hash (title + description + price + acres), so re-running only touches
changed or new listings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from ai_vocab import ai_tags, red_flags
from llm import LLMCallFailed, LLMUnavailable, call_json, is_available
from logger import get_logger

log = get_logger("enrich")


# Controlled vocabulary — Claude must pick from this list. Keeps tags stable
# across runs (important for filter UIs) and prevents hallucinated tags.
# Source of truth: scraper/ai_vocab.json.
AI_TAG_VOCABULARY: list[str] = ai_tags()
AI_RED_FLAG_VOCABULARY: list[str] = red_flags()


PROMPT_TEMPLATE = """You are analyzing a US land listing for homesteading suitability.

The listing is below. Return ONLY a JSON object (no prose, no markdown fences) with these fields:

- aiTags: array of tags chosen from this EXACT vocabulary. Pick 3-8 that apply:
{tag_vocab}

- homesteadFitScore: integer 0-100. Higher = better for self-sufficient living.
  Consider: water availability, buildability, access, utilities, restrictions,
  agricultural potential, and isolation-vs-services balance. 50 is average.

- redFlags: array of concerns chosen from this EXACT vocabulary. Empty array
  if none apply. Only flag concerns you can actually infer from the text:
{flag_vocab}

- aiSummary: 2-3 short sentences explaining the property's homesteading
  suitability. Be honest and specific. Avoid marketing language.

LISTING:
Title: {title}
Price: ${price:,.0f}
Size: {acres} acres
Price per acre: ${ppa:,.0f}
State: {state}
County: {county}
Description: {description}

Return ONLY the JSON object."""


def _content_hash(listing: dict[str, Any]) -> str:
    """Hash the listing fields that matter for enrichment. When these change,
    we must re-enrich."""
    h = hashlib.sha256()
    parts = [
        str(listing.get("title", "")),
        str(listing.get("description", "")),
        str(listing.get("price", "")),
        str(listing.get("acreage", "")),
        str(listing.get("location", {}).get("state", "")),
        str(listing.get("location", {}).get("county", "")),
    ]
    h.update("|".join(parts).encode())
    return h.hexdigest()[:16]


def _needs_enrichment(listing: dict[str, Any], force: bool) -> bool:
    if force:
        return True
    if not listing.get("enrichedAt"):
        return True
    if listing.get("_enrichHash") != _content_hash(listing):
        return True
    return False


def _build_prompt(listing: dict[str, Any]) -> str:
    price = float(listing.get("price", 0) or 0)
    acres = float(listing.get("acreage", 0) or 0)
    ppa = price / acres if acres > 0 else 0
    location = listing.get("location", {}) or {}
    return PROMPT_TEMPLATE.format(
        tag_vocab="\n".join(f"  - {t}" for t in AI_TAG_VOCABULARY),
        flag_vocab="\n".join(f"  - {t}" for t in AI_RED_FLAG_VOCABULARY),
        title=listing.get("title", "")[:200],
        price=price,
        acres=acres,
        ppa=ppa,
        state=location.get("state", ""),
        county=location.get("county", ""),
        description=(listing.get("description", "") or "")[:1500],
    )


def _sanitize_enrichment(raw: Any) -> dict[str, Any] | None:
    """Validate and coerce Claude's response into the schema we expect."""
    if not isinstance(raw, dict):
        return None

    tags = raw.get("aiTags", [])
    if not isinstance(tags, list):
        tags = []
    tags = [t for t in tags if isinstance(t, str) and t in AI_TAG_VOCABULARY]

    flags = raw.get("redFlags", [])
    if not isinstance(flags, list):
        flags = []
    flags = [f for f in flags if isinstance(f, str) and f in AI_RED_FLAG_VOCABULARY]

    score = raw.get("homesteadFitScore", 0)
    try:
        score = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        score = 0

    summary = raw.get("aiSummary", "")
    if not isinstance(summary, str):
        summary = ""
    summary = summary.strip()[:600]

    return {
        "aiTags": tags,
        "homesteadFitScore": score,
        "redFlags": flags,
        "aiSummary": summary,
    }


def enrich_listing(
    listing: dict[str, Any], model: str = "haiku"
) -> dict[str, Any] | None:
    """Call Claude for one listing and return the parsed enrichment dict.

    Returns None if Claude's output failed validation (caller should leave
    the listing unenriched rather than corrupt the record).
    """
    prompt = _build_prompt(listing)
    try:
        raw = call_json(prompt, model=model)
    except LLMCallFailed as e:
        log.info(f"[enrich] LLM call failed for {listing.get('id')}: {e}")
        return None

    return _sanitize_enrichment(raw)


def enrich_file(
    input_path: Path,
    output_path: Path,
    *,
    model: str = "haiku",
    limit: int | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Read listings from input_path, enrich them, write back to output_path.

    Returns a dict of counters for reporting.
    """
    if not is_available():
        raise LLMUnavailable(
            "`claude` CLI not available — install Claude Code and run `claude login`"
        )

    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    counters = {
        "total": len(listings),
        "skipped": 0,
        "enriched": 0,
        "failed": 0,
    }

    processed = 0
    for listing in listings:
        if not _needs_enrichment(listing, force=force):
            counters["skipped"] += 1
            continue

        if limit is not None and processed >= limit:
            counters["skipped"] += 1
            continue

        processed += 1
        log.info(
            f"[enrich] {listing.get('id')} "
            f"({processed}/{counters['total'] - counters['skipped']}): "
            f"{listing.get('title', '')[:60]}"
        )
        enrichment = enrich_listing(listing, model=model)
        if enrichment is None:
            counters["failed"] += 1
            continue

        listing.update(enrichment)
        listing["enrichedAt"] = datetime.now(timezone.utc).isoformat()
        listing["_enrichHash"] = _content_hash(listing)
        counters["enriched"] += 1

    output_path.write_text(json.dumps(listings, indent=2))
    return counters


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enrich scraped listings with AI-derived fields."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=config.DATA_DIR / "listings.json",
        help="Path to listings JSON (default: data/listings.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Where to write enriched listings (default: same as --input)",
    )
    parser.add_argument(
        "--model",
        default="haiku",
        help="Claude model: haiku (default), sonnet, or opus",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Enrich at most this many listings (testing)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-enrich listings even if their hash matches",
    )
    args = parser.parse_args()

    output_path = args.output or args.input

    try:
        counters = enrich_file(
            args.input,
            output_path,
            model=args.model,
            limit=args.limit,
            force=args.force,
        )
    except LLMUnavailable as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(
        f"Done. total={counters['total']} "
        f"enriched={counters['enriched']} "
        f"skipped={counters['skipped']} "
        f"failed={counters['failed']}"
    )
    return 0 if counters["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
