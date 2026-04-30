"""Quick AI pass to fill `location.county` for listings whose source
didn't provide one. Triggered by the 2026-04-29 Austin TX pivot:
United Country listings ship the county only inside the title or
free-text description, so the upstream `_county_filter` had nothing
to match against and let all 372 TX-statewide rows through.

This pass calls Haiku on `title + description` for each unrouted
listing and asks it to return just the county name (no "County"
suffix), then re-runs the same county filter the scraper uses, so
the resulting `listings.json` is properly trimmed to TARGET_COUNTIES.

Usage:
    python -m extract_counties
    python -m extract_counties --limit 50    # smoke test
    python -m extract_counties --force       # re-run on already-stamped rows
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
from typing import Any

import config
import llm
from logger import get_logger

log = get_logger("extract_counties")


_PROMPT = """You are a US-counties classifier. Given a real-estate
listing's title and description, return ONLY the county name (no
"County" suffix, no state, no period) where the property is located.

Rules:
- Output exactly one word/phrase. Lowercase.
- If the listing names a city, infer the county. If you cannot infer
  with high confidence, output "unknown".
- Multi-word county names: keep the words separated by a single
  space (e.g. "san jacinto", "el paso").

Title: {title}
Description: {description}

Output:"""


def _normalize_county_key(state: str, county: str) -> str:
    s = (state or "").upper()
    c = (county or "").strip().lower()
    c = re.sub(r"\s+(county|parish|borough|city and borough|census area|municipality)\s*$", "", c)
    c = c.replace(".", "")
    c = re.sub(r"\s+", " ", c).strip()
    return f"{s}|{c}" if s and c else ""


def _extract_one(listing: dict[str, Any]) -> str:
    title = (listing.get("title") or "").strip()
    desc = (listing.get("description") or "").strip()[:600]
    prompt = _PROMPT.format(title=title, description=desc)
    try:
        resp = llm.call(prompt, model="haiku", tag="extract_counties")
    except Exception as e:
        log.info(f"[extract_counties] {listing.get('id')}: llm failed: {e}")
        return ""
    text = (resp.text or "").strip()
    # First line, lowercase, strip punctuation/whitespace.
    line = text.splitlines()[0] if text else ""
    line = re.sub(r"[^a-z0-9 \-]", "", line.lower()).strip()
    if not line or line == "unknown":
        return ""
    return line


def run(
    *,
    limit: int | None = None,
    force: bool = False,
    concurrency: int = 4,
    apply_filter: bool = True,
) -> dict[str, int]:
    if not llm.is_available():
        raise RuntimeError("`claude` CLI not available — install Claude Code")
    listings_path = config.DATA_DIR / "listings.json"
    listings = json.loads(listings_path.read_text())

    targets = []
    for idx, item in enumerate(listings):
        loc = item.get("location") or {}
        if not force and (loc.get("county") or "").strip():
            continue
        targets.append(idx)
    if limit is not None:
        targets = targets[:limit]
    log.info(f"[extract_counties] processing {len(targets)} listings (concurrency={concurrency})")

    counters = {"total": len(targets), "stamped": 0, "unknown": 0}
    write_lock = Lock()

    def _worker(idx: int) -> tuple[int, str]:
        return idx, _extract_one(listings[idx])

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futs = {pool.submit(_worker, idx): idx for idx in targets}
        done = 0
        for f in as_completed(futs):
            idx, county = f.result()
            with write_lock:
                done += 1
                if county:
                    listings[idx].setdefault("location", {})["county"] = county
                    counters["stamped"] += 1
                else:
                    counters["unknown"] += 1
                if done % 25 == 0:
                    log.info(f"[extract_counties] {done}/{len(targets)} {counters}")
                # Persist incrementally so a crash doesn't lose work.
                listings_path.write_text(json.dumps(listings, indent=2))

    # Re-apply the configured TARGET_COUNTIES filter now that every
    # row has its county stamped (or we've decided it's unknown).
    if apply_filter and config.TARGET_COUNTIES:
        allowed = {c.strip() for c in config.TARGET_COUNTIES if c.strip()}
        before = len(listings)
        listings = [
            l
            for l in listings
            if _normalize_county_key(
                (l.get("location") or {}).get("state", ""),
                (l.get("location") or {}).get("county", ""),
            )
            in allowed
        ]
        log.info(
            f"[extract_counties] filter to {len(allowed)} target counties: "
            f"{before} → {len(listings)}"
        )
        listings_path.write_text(json.dumps(listings, indent=2))
        counters["after_filter"] = len(listings)
        counters["filtered_out"] = before - len(listings)

    return counters


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Re-stamp rows that already have a county")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument(
        "--no-filter",
        action="store_true",
        help="Skip the post-stamp TARGET_COUNTIES filter",
    )
    args = parser.parse_args()
    counters = run(
        limit=args.limit,
        force=args.force,
        concurrency=args.concurrency,
        apply_filter=not args.no_filter,
    )
    print(f"Done. {counters}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
