"""Image-validation pass: detect "Photo not provided"-style placeholders
that the source's CDN serves with HTTP 200 + correct content-type, so
the frontend can't tell them apart from real photos.

How it works
------------
We maintain a small JSON registry of *placeholder fingerprints* —
SHA-256 hashes of image bytes that prior runs (or the operator) have
marked as "this is the source's no-photo placeholder". When a new
scrape lands, we sample a few image URLs per source, fetch them, hash
them, and:

  - Drop any listing image URL whose hash matches a known placeholder
    fingerprint (so it can't render in the carousel).
  - Optionally promote the registry — if the same hash appears on
    >70% of a source's listings, it's almost certainly that source's
    placeholder, and we add it automatically (gated behind --learn).

This keeps the *data file* honest without requiring browser-side
detection (which CORS blocks anyway). It also lets the operator add
fingerprints by hand for known-bad images that the heuristic misses.

Throttle: 0.6 req/sec serialized to stay well under any per-host limit
and respect the project's never-blacklisted rule.

Usage
-----
    python -m scraper.image_validation                    # validate + filter
    python -m scraper.image_validation --learn            # also auto-learn
    python -m scraper.image_validation --source landwatch # one source only
    python -m scraper.image_validation --sample 5         # check N urls/listing
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import config
from logger import get_logger

log = get_logger("image_validation")

REGISTRY_PATH = config.DATA_DIR / "_image_placeholders.json"
THROTTLE_S = 1.5  # ~0.66 req/sec
LEARN_THRESHOLD = 0.5  # ≥50% of sampled images sharing a hash → placeholder


def _load_registry() -> dict[str, list[str]]:
    """Registry shape: { source_name: [hex-sha256, ...] }.

    A hash listed under a source means "any image whose bytes hash to
    this on this source is the source's placeholder; drop it." We
    namespace by source so an unrelated source's placeholder hash
    can't accidentally filter another source's real photos.
    """
    if not REGISTRY_PATH.exists():
        return {}
    try:
        return json.loads(REGISTRY_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save_registry(reg: dict[str, list[str]]) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(reg, indent=2, sort_keys=True))


def _fetch_bytes(url: str) -> bytes | None:
    """Fetch image bytes via curl_cffi (Chrome TLS impersonation).

    Some image CDNs (LandWatch, Akamai-fronted hosts) reject plain
    requests; mimicking Chrome avoids those 403s. Returns None on
    any error so the caller can decide what to do.
    """
    try:
        from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
    except ImportError:
        log.info("[image_validation] curl_cffi not installed; cannot fetch")
        return None
    try:
        r = cffi_requests.get(url, impersonate="chrome131", timeout=15)
        r.raise_for_status()
        return r.content
    except Exception as e:
        log.info(f"[image_validation] fetch {url} → {type(e).__name__}: {e}")
        return None


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sample_per_listing(
    listings: list[dict[str, Any]], k: int
) -> dict[str, list[str]]:
    """Pick up to `k` URLs from each listing, grouped by source. Skips
    sources with no listings, and listings with no images."""
    by_source: dict[str, list[str]] = defaultdict(list)
    for item in listings:
        urls = item.get("images") or []
        if not urls:
            continue
        source = item.get("source") or "unknown"
        chosen = random.sample(urls, min(k, len(urls)))
        by_source[source].extend(chosen)
    return by_source


def _learn_placeholders(
    by_source: dict[str, list[str]],
    registry: dict[str, list[str]],
) -> dict[str, list[str]]:
    """For each source, fetch the sampled URLs, hash them, and treat
    any hash that dominates ≥LEARN_THRESHOLD of samples as a freshly
    discovered placeholder. Adds it to the registry in-place and
    returns the (mutated) registry.
    """
    for source, urls in by_source.items():
        if len(urls) < 6:
            log.info(f"[image_validation] {source}: sample too small ({len(urls)})")
            continue
        hashes: list[str] = []
        for i, url in enumerate(urls):
            data = _fetch_bytes(url)
            if data:
                hashes.append(_hash_bytes(data))
            if i < len(urls) - 1:
                time.sleep(THROTTLE_S)
        if not hashes:
            continue
        counts = Counter(hashes)
        dominant_hash, dominant_count = counts.most_common(1)[0]
        ratio = dominant_count / len(hashes)
        if ratio >= LEARN_THRESHOLD:
            existing = set(registry.get(source, []))
            if dominant_hash not in existing:
                registry.setdefault(source, []).append(dominant_hash)
                log.info(
                    f"[image_validation] {source}: learned placeholder "
                    f"{dominant_hash[:12]}… ({dominant_count}/{len(hashes)} = {ratio:.0%})"
                )
    return registry


def _filter_listings(
    listings: list[dict[str, Any]],
    registry: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], int]:
    """Walk every listing, hash each `images[]` URL via fetch, and
    drop URLs whose hash is in the registry for that source.

    NOTE: this fetches every URL, which is expensive. We avoid that by
    only checking when the registry has at least one fingerprint for
    the listing's source — sources with no known placeholders skip
    the network entirely.

    Returns (mutated listings, number of listings touched).
    """
    touched = 0
    for item in listings:
        source = item.get("source") or "unknown"
        bad_hashes = set(registry.get(source, []))
        if not bad_hashes:
            continue
        urls = item.get("images") or []
        if not urls:
            continue
        kept: list[str] = []
        dropped = 0
        for url in urls:
            data = _fetch_bytes(url)
            if data and _hash_bytes(data) in bad_hashes:
                dropped += 1
                continue
            kept.append(url)
            time.sleep(THROTTLE_S)
        if dropped:
            item["images"] = kept
            touched += 1
            log.info(
                f"[image_validation] {item.get('id')}: dropped {dropped} "
                f"placeholder image(s)"
            )
    return listings, touched


def run(
    input_path: Path,
    *,
    learn: bool = False,
    source_filter: str | None = None,
    sample: int = 3,
) -> dict[str, int]:
    if not input_path.exists():
        print(f"No listings file at {input_path}")
        return {"learned": 0, "filtered": 0}

    listings: list[dict[str, Any]] = json.loads(input_path.read_text())
    if source_filter:
        scope = [item for item in listings if item.get("source") == source_filter]
    else:
        scope = listings
    print(f"Validating images for {len(scope)} listings…")

    registry = _load_registry()
    learned = 0
    if learn:
        before = sum(len(v) for v in registry.values())
        sampled = _sample_per_listing(scope, sample)
        registry = _learn_placeholders(sampled, registry)
        after = sum(len(v) for v in registry.values())
        learned = after - before
        if learned:
            _save_registry(registry)
            print(f"  Learned {learned} new placeholder fingerprint(s)")

    listings, touched = _filter_listings(listings, registry)
    if touched:
        input_path.write_text(json.dumps(listings, indent=2))
        print(f"  Filtered placeholders out of {touched} listing(s)")
    else:
        print("  No placeholders detected against the current registry.")
    return {"learned": learned, "filtered": touched}


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate scraped images for placeholders")
    parser.add_argument("--learn", action="store_true", help="Auto-promote dominant hashes to placeholder registry")
    parser.add_argument("--source", help="Limit to a single source")
    parser.add_argument("--sample", type=int, default=3, help="URLs to sample per listing during --learn")
    parser.add_argument("--input", type=Path, default=config.DATA_DIR / "listings.json")
    args = parser.parse_args()
    if not args.input.exists():
        print(f"Input missing: {args.input}", file=sys.stderr)
        sys.exit(1)
    run(args.input, learn=args.learn, source_filter=args.source, sample=args.sample)


if __name__ == "__main__":
    main()
