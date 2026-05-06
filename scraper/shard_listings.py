"""Shard `data/listings.json` into a slim index + per-listing detail files.

The combined listings.json has grown to ~12 MB and every Browse page
load downloads it whole. Splitting into:

    data/listings_index.json   ~1-2 MB   slim per-listing summary + SS
    data/listings/<id>.json    ~10-20 KB  full per-listing record

…cuts first paint by ~5×. The slim index has everything Browse cards
+ filter logic need (id, headlines, location, scores, features, AI
tags, red flags, status, taxSale.amountOwedUsd, plus the
pre-computed Self-Sufficiency composite + axis scores). The full
per-id files carry detail-page extras: full description, AI summary,
geoEnrichment, investmentBreakdown, voting, full taxSale, etc.

Run with:

    python -m scraper.shard_listings

Idempotent — safe to re-run after every scrape. The CI scrape
workflow calls this after `python main.py` writes listings.json.

Backwards compat: leaves listings.json in place unchanged. If the
frontend can't reach listings_index.json (e.g. fresh deploy that
predates this script), it falls through to listings.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Sibling-module import. Uses the same bare-import convention as the
# rest of the scraper package (config, logger, etc.). Run with
# `cd scraper && python -m shard_listings` to match how main.py
# scripts are invoked in CI.
from self_sufficiency import compute_self_sufficiency  # noqa: E402

# ── Slim-index schema ────────────────────────────────────────────────
#
# Fields kept on each row in listings_index.json. Anything not here
# moves to the per-id detail file. Description is included but
# truncated to support free-text search on Browse without shipping
# 5KB+ scraper descriptions for every listing.

INDEX_FIELDS = {
    # Identity
    "id", "title", "source", "url", "dateFound", "status",
    # Headline
    "price", "acreage", "pricePerAcre", "residualPricePerAcre",
    "residualLandPrice", "estimatedStructureValueUsd",
    "estimatedBuildoutUsd",
    # Location (full sub-record kept — small)
    "location",
    # Scores
    "dealScore", "investmentScore", "homesteadFitScore",
    # AI (short arrays)
    "aiTags", "redFlags",
    # Features / improvements (small, used by filters)
    "features", "improvements", "moveInReady",
    # Validation
    "validated", "validatedAt",
    # Images (URLs only — small)
    "imageUrl", "images",
}

# Description is truncated rather than dropped because Browse's
# free-text search filter checks the description. 500 chars covers
# any reasonable substring match without ballooning the index.
DESCRIPTION_TRUNCATE = 500


def slim_record(p: dict[str, Any]) -> dict[str, Any]:
    """Project a full listing into the slim-index shape + stamped SS."""
    out: dict[str, Any] = {k: p[k] for k in INDEX_FIELDS if k in p}

    # Truncated description for search
    desc = p.get("description")
    if isinstance(desc, str) and desc:
        out["description"] = (
            desc[:DESCRIPTION_TRUNCATE] + "…"
            if len(desc) > DESCRIPTION_TRUNCATE
            else desc
        )

    # Tax-sale rows: keep only the field cards reference (min bid).
    # Full taxSale (cause #, redemption details, analytics notes) is
    # detail-only.
    ts = p.get("taxSale")
    if isinstance(ts, dict) and "amountOwedUsd" in ts:
        out["taxSale"] = {
            "amountOwedUsd": ts.get("amountOwedUsd"),
            "stateType": ts.get("stateType"),
        }

    # Pre-computed Self-Sufficiency — the headline metric. Lets
    # PropertyCard render the SS ring + 5 axis bars without needing
    # the full geoEnrichment subtree. Saves ~70% of per-row bytes.
    out["selfSufficiency"] = compute_self_sufficiency(p)

    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--src",
        type=Path,
        default=Path("data/listings.json"),
        help="Path to source listings.json.",
    )
    ap.add_argument(
        "--index-out",
        type=Path,
        default=Path("data/listings_index.json"),
        help="Output path for the slim index.",
    )
    ap.add_argument(
        "--detail-dir",
        type=Path,
        default=Path("data/listings"),
        help="Output directory for per-listing detail files.",
    )
    args = ap.parse_args()

    if not args.src.exists():
        print(f"missing source: {args.src}", file=sys.stderr)
        return 1

    listings = json.loads(args.src.read_text())
    if not isinstance(listings, list):
        print(f"unexpected shape — wanted a list, got {type(listings).__name__}", file=sys.stderr)
        return 2

    args.detail_dir.mkdir(parents=True, exist_ok=True)
    # Wipe stale per-id files so deletions in the source list flow
    # through (a listing pulled from the corpus shouldn't linger as a
    # 404-able detail file).
    existing_ids = {p.stem for p in args.detail_dir.glob("*.json")}
    fresh_ids: set[str] = set()

    index = []
    for raw in listings:
        if not isinstance(raw, dict):
            continue
        listing_id = raw.get("id")
        if not isinstance(listing_id, str) or not listing_id:
            continue
        fresh_ids.add(listing_id)

        # Slim row → index
        index.append(slim_record(raw))

        # Full row → per-id file. Keep all fields verbatim so the
        # detail page sees what the scraper wrote.
        (args.detail_dir / f"{listing_id}.json").write_text(
            json.dumps(raw, separators=(",", ":"))
        )

    args.index_out.parent.mkdir(parents=True, exist_ok=True)
    args.index_out.write_text(json.dumps(index, separators=(",", ":")))

    # Drop stale per-id files (listings that were in the corpus before
    # but not in this run).
    stale = existing_ids - fresh_ids
    for sid in stale:
        (args.detail_dir / f"{sid}.json").unlink(missing_ok=True)

    src_size = args.src.stat().st_size / (1024 * 1024)
    idx_size = args.index_out.stat().st_size / (1024 * 1024)
    print(f"source listings.json: {src_size:.1f} MB ({len(listings)} rows)", file=sys.stderr)
    print(f"slim index:           {idx_size:.1f} MB ({len(index)} rows)", file=sys.stderr)
    print(f"per-id detail files:  {len(fresh_ids)} fresh, {len(stale)} stale removed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
