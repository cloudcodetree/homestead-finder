"""Produce a curated "top picks" list by asking Claude to rank enriched listings.

Input:  data/listings.json (must already be enriched via scraper/enrich.py)
Output: data/curated.json  — ranked picks with per-listing headlines + reasons

Runs locally (uses scraper/llm.py). Not safe to run in CI.

Usage:
    python -m scraper.curate                     # default: top 12 picks
    python -m scraper.curate --count 20          # top 20
    python -m scraper.curate --candidates 80     # cast a wider net
    python -m scraper.curate --model sonnet      # bump model (default: sonnet)

Two-stage design:
  1. Deterministic pre-ranking — narrow the pool by combined score so we
     don't pay to send 500 listings to Claude.
  2. Claude ranking — given the top-K candidates with full context, pick
     the best N for homesteading and explain why.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config
from llm import LLMCallFailed, LLMUnavailable, call_json, is_available
from logger import get_logger

log = get_logger("curate")


# Default curation parameters
DEFAULT_CURATED_COUNT = 12
DEFAULT_CANDIDATE_COUNT = 50
DEFAULT_MODEL = "sonnet"  # bump up vs. enrich — this is one expensive call, not N cheap ones


def _prerank_candidates(
    listings: list[dict[str, Any]], limit: int
) -> list[dict[str, Any]]:
    """Pick the top N candidates deterministically before sending to the LLM.

    Combined score weights AI fit a bit higher than the rule-based deal
    score since we're specifically curating for homesteading.
    """
    enriched = [item for item in listings if item.get("enrichedAt")]

    def combined_score(item: dict[str, Any]) -> float:
        deal = float(item.get("dealScore", 0) or 0)
        fit = float(item.get("homesteadFitScore", 0) or 0)
        # Penalize listings with red flags so they compete at a disadvantage
        # rather than getting filtered out entirely — Claude can still pick
        # them if it thinks they're worth flagging.
        penalty = 5 * len(item.get("redFlags", []) or [])
        return 0.4 * deal + 0.6 * fit - penalty

    return sorted(enriched, key=combined_score, reverse=True)[:limit]


def _compact_listing(item: dict[str, Any]) -> dict[str, Any]:
    """Strip a listing down to the fields useful for curation.

    Keeping the prompt tight matters when sending ~50 listings in one call.
    """
    loc = item.get("location", {}) or {}
    return {
        "id": item.get("id"),
        "title": (item.get("title") or "")[:120],
        "price": item.get("price"),
        "acreage": item.get("acreage"),
        "pricePerAcre": item.get("pricePerAcre"),
        "state": loc.get("state", ""),
        "county": loc.get("county", ""),
        "dealScore": item.get("dealScore"),
        "homesteadFitScore": item.get("homesteadFitScore"),
        "aiTags": item.get("aiTags") or [],
        "redFlags": item.get("redFlags") or [],
        "aiSummary": item.get("aiSummary") or "",
    }


def _build_curation_prompt(
    candidates: list[dict[str, Any]], pick_count: int
) -> str:
    compact = [_compact_listing(c) for c in candidates]
    payload = json.dumps(compact, indent=2)
    return f"""You are a homesteading scout. Pick the {pick_count} best land listings
from the candidates below for someone pursuing self-sufficient rural living.

Prioritize: reliable water, buildability, genuine off-grid viability, honest
pricing per acre relative to size, and absence of restrictions. Penalize red
flags but don't auto-reject — some flags are minor, and a great property with
one caveat can beat a mediocre property with none.

Return ONLY a JSON object with this exact shape (no prose, no markdown):

{{
  "picks": [
    {{
      "id": "<listing id exactly as given>",
      "rank": 1,
      "headline": "<5-9 word catchy label, no emoji>",
      "reason": "<2-3 sentences, concrete and specific. Reference actual numbers and features. Avoid marketing language. If there's a caveat, say so.>"
    }},
    ...
  ]
}}

The picks array must have exactly {pick_count} entries, ranked 1-{pick_count}
(1 = best). Each id MUST match one of the candidate ids below exactly.

CANDIDATES (JSON):
{payload}
"""


def _sanitize_curation(
    raw: Any, valid_ids: set[str], expected_count: int
) -> list[dict[str, Any]]:
    """Coerce the model's response into a clean list of picks.

    Drops unknown ids, de-dupes, re-numbers ranks, truncates to expected size.
    """
    if not isinstance(raw, dict):
        raise LLMCallFailed("curation response was not a JSON object")

    picks = raw.get("picks")
    if not isinstance(picks, list):
        raise LLMCallFailed("curation response missing 'picks' array")

    seen_ids: set[str] = set()
    cleaned: list[dict[str, Any]] = []
    for p in picks:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or pid not in valid_ids or pid in seen_ids:
            continue
        seen_ids.add(pid)
        cleaned.append(
            {
                "id": pid,
                "headline": str(p.get("headline", ""))[:120],
                "reason": str(p.get("reason", ""))[:800],
            }
        )

    # Re-number ranks so they're always 1..N regardless of what the model returned
    for i, pick in enumerate(cleaned[:expected_count], start=1):
        pick["rank"] = i

    return cleaned[:expected_count]


def curate(
    input_path: Path,
    output_path: Path,
    *,
    pick_count: int = DEFAULT_CURATED_COUNT,
    candidate_count: int = DEFAULT_CANDIDATE_COUNT,
    model: str = DEFAULT_MODEL,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Run the curation pass and write results to output_path."""
    if not is_available():
        raise LLMUnavailable(
            "`claude` CLI not available — install Claude Code and run `claude login`"
        )

    listings = json.loads(input_path.read_text())
    if not isinstance(listings, list):
        raise ValueError(f"expected a JSON array in {input_path}")

    candidates = _prerank_candidates(listings, candidate_count)
    if len(candidates) < pick_count:
        log.info(
            f"[curate] only {len(candidates)} enriched listings available, "
            f"below requested pick count {pick_count}; picking all"
        )
        pick_count = len(candidates)

    if pick_count == 0:
        raise ValueError(
            "no enriched listings found — run `python -m scraper.enrich` first"
        )

    prompt = _build_curation_prompt(candidates, pick_count)
    log.info(
        f"[curate] calling {model} with {len(candidates)} candidates "
        f"for {pick_count} picks ({len(prompt)} chars)"
    )
    raw = call_json(prompt, model=model, use_cache=use_cache)

    valid_ids = {c["id"] for c in candidates}
    picks = _sanitize_curation(raw, valid_ids, pick_count)

    result = {
        "curatedAt": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "candidateCount": len(candidates),
        "pickCount": len(picks),
        "picks": picks,
    }
    output_path.write_text(json.dumps(result, indent=2))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate top homesteading picks using Claude."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=config.DATA_DIR / "listings.json",
        help="Path to enriched listings JSON (default: data/listings.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=config.DATA_DIR / "curated.json",
        help="Where to write curation results (default: data/curated.json)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_CURATED_COUNT,
        help=f"Number of picks to produce (default: {DEFAULT_CURATED_COUNT})",
    )
    parser.add_argument(
        "--candidates",
        type=int,
        default=DEFAULT_CANDIDATE_COUNT,
        help=f"Candidate pool size sent to Claude (default: {DEFAULT_CANDIDATE_COUNT})",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Claude model (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Force a fresh call, bypassing the on-disk LLM cache",
    )
    args = parser.parse_args()

    try:
        result = curate(
            args.input,
            args.output,
            pick_count=args.count,
            candidate_count=args.candidates,
            model=args.model,
            use_cache=not args.no_cache,
        )
    except (LLMUnavailable, ValueError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except LLMCallFailed as e:
        print(f"error: curation call failed: {e}", file=sys.stderr)
        return 2

    print(
        f"Done. picks={result['pickCount']} "
        f"candidates={result['candidateCount']} "
        f"model={result['model']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
