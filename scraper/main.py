"""Main scraper orchestrator — runs all enabled sources and outputs listings.json."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from typing import Any

import config
from logger import get_logger
from notifier import (
    filter_homestead_gems,
    filter_hot_deals,
    send_deal_alert,
    send_homestead_gems_alert,
)
from schema_migrate import migrate_corpus, stamp as schema_stamp
from scoring import ScoringEngine
from sources.auction import AuctionScraper
from sources.tax_sale_analytics import analyze_listings as analyze_tax_sale_listings
from sources.blm import BLMScraper
from sources.county_tax import CountyTaxScraper
from sources.govease import GovEaseScraper
# Craigslist disabled — see ALL_SCRAPERS for the full reason. Import
# left out so unused-import lint stays clean; restoring requires this
# line and the dict entry below.
from sources.homestead_crossing import HomesteadCrossingScraper
from sources.landhub import LandHubScraper
from sources.lands_of_america import LandsOfAmericaScraper
from sources.landwatch import LandWatchScraper
from sources.mossy_oak import MossyOakScraper
from sources.ozarkland import OzarkLandScraper
from sources.united_country import UnitedCountryScraper
from sources.realtor import RealtorScraper
from sources.zillow import ZillowScraper

log = get_logger("main")

# Registry of all scrapers
ALL_SCRAPERS = {
    "landwatch": LandWatchScraper,
    "lands_of_america": LandsOfAmericaScraper,
    "homestead_crossing": HomesteadCrossingScraper,
    "ozarkland": OzarkLandScraper,
    "united_country": UnitedCountryScraper,
    "mossy_oak": MossyOakScraper,
    # craigslist disabled 2026-04-28: URL builder is broken on two
    # axes — points at the apex craigslist.org instead of a regional
    # subdomain (apex 404s every listing) and captures the wrong
    # integer as the post ID (a sequence offset, not the post ID).
    # Real post ID = decode.minPostingId + item[0]. Fix is to build a
    # lat/lng→subdomain resolver since decode.locations is unreliable
    # (Cherokee Village geo-prefix points at fayar but the actual
    # listing lives under jonesboro). Until the URL builder is fixed
    # every craigslist row ships a 404 outbound link, so we don't run
    # the scraper. Restore: re-add `from sources.craigslist import
    # CraigslistScraper` to the imports above and uncomment the line:
    #     "craigslist": CraigslistScraper,
    "landhub": LandHubScraper,
    "zillow": ZillowScraper,
    "realtor": RealtorScraper,
    "county_tax": CountyTaxScraper,
    "auction": AuctionScraper,
    "blm": BLMScraper,
    "govease": GovEaseScraper,
}


_LEASE_KEYWORDS = re.compile(
    r"(?i)\b(equity share|hunt club share|annual lease|lease term|/yr\b|per year|"
    r"per acre per year|/acre/year)\b"
)


def _is_likely_lease_or_share(listing: dict[str, Any]) -> bool:
    """Return True for listings that look like annual leases, hunt-club
    shares, or other not-a-sale rows that LandWatch et al. mix into
    /...for-sale/ URL patterns.

    Two signals — either is sufficient:
      1. price/acre < $50 on a tract over 1 acre (annual lease rates
         are typically $5-$50/acre/year; legit rural sales floor is
         ~$100-500/acre even for unimproved land).
      2. Lease/share keyword in title or description.
    """
    try:
        price = float(listing.get("price", 0) or 0)
        acres = float(listing.get("acreage", 0) or 0)
    except (TypeError, ValueError):
        price = acres = 0.0
    if price > 0 and acres > 1 and (price / acres) < 50:
        return True
    title = str(listing.get("title", ""))
    desc = str(listing.get("description", ""))
    if _LEASE_KEYWORDS.search(title) or _LEASE_KEYWORDS.search(desc):
        return True
    return False


def load_previously_seen() -> set[str]:
    """Load IDs of listings we've already sent notifications for."""
    seen_file = config.DATA_DIR / "notified.json"
    if seen_file.exists():
        try:
            return set(json.loads(seen_file.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return set()


def save_previously_seen(seen: set[str]) -> None:
    """Persist notified listing IDs."""
    seen_file = config.DATA_DIR / "notified.json"
    seen_file.write_text(json.dumps(sorted(seen), indent=2))


def run(
    dry_run: bool = False,
    source_filter: str | None = None,
    states: list[str] | None = None,
    max_pages: int | None = None,
) -> list[dict]:
    """Run all enabled scrapers and return scored listings."""
    target_states = states or config.TARGET_STATES
    max_pages_val = max_pages or config.MAX_PAGES_PER_SOURCE
    engine = ScoringEngine()

    # In CI, drop local-only sources (Cloudflare-walled or ToS-restricted —
    # see LOCAL_ONLY_SOURCES doc in config.py). The developer runs these
    # from a residential IP and commits the resulting listings.json
    # fragment alongside CI's runs. Override with `CI=false` env var
    # for local CI-simulation runs.
    import os as _os

    in_ci = _os.environ.get("CI", "").lower() in ("1", "true", "yes")
    skipped_local_only: list[str] = []

    # Determine which scrapers to run
    active_scrapers: dict[str, Any] = {}
    for name, cls in ALL_SCRAPERS.items():
        if not config.ENABLED_SOURCES.get(name, False):
            continue
        if source_filter is not None and name != source_filter:
            continue
        if in_ci and name in config.LOCAL_ONLY_SOURCES:
            skipped_local_only.append(name)
            continue
        active_scrapers[name] = cls

    if skipped_local_only:
        print(
            f"  [CI] Skipping local-only sources: {', '.join(skipped_local_only)}"
        )

    if not active_scrapers:
        print("No scrapers enabled. Check config.ENABLED_SOURCES.")
        return []

    print(
        f"Running {len(active_scrapers)} scrapers across {len(target_states)} states..."
    )
    print(f"Target states: {', '.join(target_states)}")
    print()

    all_results: list[dict] = []
    for name, scraper_cls in active_scrapers.items():
        print(f"  [{name}] Fetching...")
        try:
            scraper = scraper_cls(config={})
            results = scraper.scrape(states=target_states, max_pages=max_pages_val)
            print(f"  [{name}] {len(results)} listings found")
            all_results.extend(results)
        except Exception as e:
            print(f"  [{name}] ERROR: {e}")

    # Deduplicate by URL
    seen_urls: set[str] = set()
    unique = []
    for p in all_results:
        url = p.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique.append(p)
    print(f"\n  Deduplicated: {len(all_results)} → {len(unique)} unique listings")

    # Reject lease / equity-share / hunt-club listings. LandWatch and
    # Land.com lump these into the same /...for-sale/ URL pattern as
    # real sales, so a price-based heuristic is the cleanest filter:
    #   - $/acre below $50 with > 1 acre is almost always an annual
    #     lease rate (genuine rural land has a ~$500/acre floor; even
    #     remote unimproved tracts rarely go under $100/acre).
    #   - Title or description containing "equity share", "hunt club
    #     share", "annual lease", "/yr", "per year" is a fractional
    #     ownership or rental, not a sale.
    # Both checks are conservative — false positives would only kill
    # listings that already look indistinguishable from leases.
    pre_filter = len(unique)
    unique = [p for p in unique if not _is_likely_lease_or_share(p)]
    if pre_filter != len(unique):
        print(f"  Filtered lease / equity-share rows: {pre_filter} → {len(unique)}")

    # Score all listings
    scored = engine.score_all(unique)

    # Sort by deal score descending
    scored.sort(key=lambda p: p.get("dealScore", 0), reverse=True)

    # Print top deals
    print("\n  Top deals:")
    for p in scored[:5]:
        loc = p.get("location", {})
        print(
            f"    Score {p.get('dealScore'):3d} | "
            f"{p.get('acreage', 0):.0f} acres, "
            f"${p.get('price', 0):,.0f} | "
            f"{loc.get('county', '')} County, {loc.get('state', '')} | "
            f"${p.get('pricePerAcre', 0):,.0f}/acre"
        )

    if dry_run:
        print("\n  [dry-run] Not writing output files.")
        return scored

    # Merge with existing listings so partial runs (--source=X) don't wipe
    # data produced by other sources. Two-part merge:
    #   1. Existing rows with no id collision are preserved as-is.
    #   2. Same-id rows from this run OVERLAY the fresh scrape but
    #      PRESERVE expensive enrichment fields (detail_fetcher output,
    #      AI enrichment from enrich.py, geo enrichment from enrich_geo.py,
    #      tax-sale analytics). Without this, the daily CI LandWatch
    #      scrape silently overwrites lat/lng + full descriptions + AI
    #      tags on every listing it re-fetches.
    _PRESERVE_ON_OVERWRITE = (
        "detailFetchedAt",
        "externalLinks",
        "geoEnrichment",
        "aiTags",
        "aiSummary",
        "homesteadFitScore",
        "redFlags",
        "enrichedAt",
        "_enrichHash",
        "taxSale",
    )
    output_path = config.DATA_DIR / "listings.json"
    merged: list[dict] = list(scored)
    current_by_id = {p.get("id"): p for p in scored if p.get("id")}
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text())
            if isinstance(existing, list):
                kept: list[dict] = []
                enriched_count = 0
                for prev in existing:
                    prev_id = prev.get("id")
                    if prev_id not in current_by_id:
                        kept.append(prev)
                        continue
                    # Same id — layer preserved fields from prev onto the
                    # fresh scrape row (which is already in `merged`).
                    current = current_by_id[prev_id]
                    carried = False
                    for field in _PRESERVE_ON_OVERWRITE:
                        if field in prev and field not in current:
                            current[field] = prev[field]
                            carried = True
                    # Preserve a longer detail-fetched description over a
                    # freshly-scraped short search-card blurb.
                    prev_desc = prev.get("description") or ""
                    new_desc = current.get("description") or ""
                    if len(prev_desc) > len(new_desc) + 200:
                        current["description"] = prev_desc
                        carried = True
                    # Preserve lat/lng when the fresh row has zeros.
                    prev_loc = prev.get("location") or {}
                    cur_loc = current.setdefault("location", {})
                    if prev_loc.get("lat") not in (None, 0, 0.0) and cur_loc.get(
                        "lat"
                    ) in (None, 0, 0.0):
                        cur_loc["lat"] = prev_loc["lat"]
                        cur_loc["lng"] = prev_loc.get("lng", cur_loc.get("lng"))
                        carried = True
                    if carried:
                        enriched_count += 1
                merged = kept + scored
                if kept or enriched_count:
                    print(
                        f"  Merged: {len(kept)} other-source preserved, "
                        f"{enriched_count}/{len(scored)} fresh rows kept prior enrichment"
                    )
        except (OSError, json.JSONDecodeError) as e:
            print(f"  (could not merge with existing listings.json: {e})")

    # Stamp investment analytics onto every tax-sale row using the full
    # merged corpus — county $/acre medians come from the LandWatch side,
    # so we can only compute them AFTER merging. Cheap/idempotent.
    try:
        analyze_tax_sale_listings(merged)
        tax_count = sum(1 for p in merged if p.get("status") == "tax_sale")
        if tax_count:
            print(f"  Tax-sale analytics applied to {tax_count} records")
    except Exception as e:
        print(f"  (tax-sale analytics failed: {e})")

    # Schema-version pass — every row gets walked forward to
    # CURRENT_VERSION via the migration chain (no-op today; the
    # framework is here for the first time we need to restructure
    # without re-scraping). Also stamps fresh rows missing the field.
    merged = [schema_stamp(r) for r in merged]
    merged, migrated_count = migrate_corpus(merged)
    if migrated_count:
        print(f"  Schema migrations applied to {migrated_count} rows")

    output_path.write_text(json.dumps(merged, indent=2))
    print(f"\n  Written: {output_path} ({len(merged)} listings)")

    # Shadow-write to the SQLite store. JSON remains canonical for the
    # static frontend; this gives subsequent passes (image_refresh,
    # enrich, deals, …) a SQL surface to work against instead of
    # re-reading + re-writing the JSON each time. Idempotent — failures
    # here never break the JSON write that already succeeded.
    import os as _os

    if not _os.environ.get("SKIP_DB_SYNC"):
        try:
            from db_io import import_from_json

            n = import_from_json(output_path)
            if n:
                print(f"  DB synced: {n} listings → corpus.sqlite")
        except Exception as e:
            print(f"  (db sync failed; JSON is still authoritative: {e})")

    # Generic image refresh — works for every source. Detects rows
    # with synthesized/placeholder image URLs (heuristic: every URL
    # ends with the listing's own PID) and re-extracts real CDN URLs
    # from each listing's detail page. Per-source regex extractors
    # registered in image_refresh.EXTRACTORS run first; sources
    # without one fall through to the AI fallback (Claude reads the
    # HTML and pulls photo URLs). Idempotent + throttled at
    # ~0.7 req/sec serialized. Skip with SKIP_IMAGE_REFRESH=1
    # (legacy SKIP_LW_IMAGES still honored for back-compat).
    import os as _os

    if not _os.environ.get("SKIP_IMAGE_REFRESH") and not _os.environ.get("SKIP_LW_IMAGES"):
        try:
            from image_refresh import run as refresh_images

            print("  Refreshing image URLs from detail pages…")
            refresh_images(output_path)
        except Exception as e:
            print(f"  (image refresh failed: {e})")

    # Daily health check — week-over-week diff per source. Surfaces
    # silent regressions (a source returning 0 listings, image
    # coverage cratering, geo coverage dropping). Non-fatal: a breach
    # is logged + emailed but doesn't abort the rest of the pipeline.
    # Skip with HEALTH_CHECK_SKIP=1 during fast iterations.
    if not _os.environ.get("HEALTH_CHECK_SKIP"):
        try:
            from health_check import run as health_run

            health_run(output_path, alert=True)
        except Exception as e:
            print(f"  (health check failed: {e})")

    if config.SAVE_DATED_SNAPSHOT:
        snapshot_path = config.DATA_DIR / f"listings_{date.today().isoformat()}.json"
        snapshot_path.write_text(json.dumps(scored, indent=2))
        print(f"  Snapshot: {snapshot_path}")

    # Two parallel notification channels driven off the same notified.json:
    # 1. Legacy "hot deals" — anything with dealScore ≥ threshold
    # 2. Homestead gems — new listings that pass the Deals-view filters
    #    AND score highly on both rule-based deal + AI fit. Separate
    #    pool so an already-alerted hot deal doesn't re-alert as a gem.
    previously_seen = load_previously_seen()

    hot_deals = filter_hot_deals(scored, previously_seen=previously_seen)
    if hot_deals:
        print(f"\n  {len(hot_deals)} new hot deals — sending notification...")
        if send_deal_alert(hot_deals):
            for deal in hot_deals:
                previously_seen.add(deal.get("id", ""))
    else:
        print("  No new hot deals above threshold.")

    # Homestead gems filter against the MERGED corpus (so we alert on
    # genuinely-new-to-us listings even if they came from a cached scrape).
    gems = filter_homestead_gems(merged, previously_seen=previously_seen)
    if gems:
        print(f"\n  {len(gems)} new homestead gems — sending gem alert...")
        if send_homestead_gems_alert(gems):
            for gem in gems:
                previously_seen.add(gem.get("id", ""))
    else:
        print("  No new homestead gems passing the filter bar.")

    save_previously_seen(previously_seen)
    return scored


def validate_selectors() -> None:
    """Validate all learned selectors against live pages."""
    from ai.selectors import load_selectors

    selectors_dir = config.LEARNED_SELECTORS_DIR
    if not selectors_dir.exists():
        print("No learned selectors directory found.")
        return

    print("Learned Selector Validation Report")
    print("=" * 40)
    for path in sorted(selectors_dir.glob("*.json")):
        source = path.stem
        data = load_selectors(source)
        if data is None:
            print(f"  {source}: ERROR (could not load)")
            continue
        streak = data.get("validation_streak", 0)
        confidence = data.get("confidence", 0)
        version = data.get("version", "?")
        last = data.get("last_validated", "never")
        print(
            f"  {source}: v{version} | confidence: {confidence:.2f} | "
            f"streak: {streak} | last validated: {last}"
        )


def print_cost_summary() -> None:
    """Print AI cost summary for the run."""
    try:
        from strategies.cost_tracker import get_summary

        summary = get_summary()
        if summary["today_calls"] > 0:
            print(
                f"\n  AI costs: ${summary['today_spend']:.4f} today "
                f"({summary['today_calls']} calls), "
                f"${summary['lifetime_spend']:.4f} lifetime"
            )
    except Exception:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Homestead Finder scraper")
    parser.add_argument(
        "--dry-run", action="store_true", help="Fetch but don't write output"
    )
    parser.add_argument("--source", help="Run only this source (e.g. landwatch)")
    parser.add_argument(
        "--states", help="Comma-separated states to target (e.g. MT,ID,WY)"
    )
    parser.add_argument("--max-pages", type=int, help="Max pages per source per state")
    parser.add_argument(
        "--no-ai", action="store_true", help="Disable AI fallback for this run"
    )
    parser.add_argument(
        "--ai-max-tier",
        type=int,
        choices=[1, 2, 3],
        help="Max AI model tier (1=Haiku, 2=Sonnet, 3=Opus)",
    )
    parser.add_argument(
        "--validate-selectors",
        action="store_true",
        help="Validate learned selectors and exit",
    )
    parser.add_argument(
        "--skip-image-refresh",
        action="store_true",
        help="Skip the generic detail-page photo refresh pass (faster iteration; "
        "broken `{N}-{PID}` URLs will remain on listings that haven't been refreshed)",
    )
    # Back-compat alias — older invocations / docs still reference the
    # LandWatch-specific flag. Both map to SKIP_IMAGE_REFRESH now.
    parser.add_argument(
        "--skip-landwatch-images",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    if args.validate_selectors:
        validate_selectors()
        return

    # Map the CLI flag(s) to the env vars the run() routine inspects
    # so flag + env paths honor the same gate.
    if args.skip_image_refresh or args.skip_landwatch_images:
        import os as _os

        _os.environ["SKIP_IMAGE_REFRESH"] = "1"

    # Override AI settings if flags provided
    if args.no_ai:
        config.AI_FALLBACK_ENABLED = False
    if args.ai_max_tier is not None:
        from ai.config import TASK_MODEL_DEFAULTS

        for task in TASK_MODEL_DEFAULTS.values():
            task["max_tier"] = min(task["max_tier"], args.ai_max_tier)

    states = args.states.split(",") if args.states else None

    results = run(
        dry_run=args.dry_run,
        source_filter=args.source,
        states=states,
        max_pages=args.max_pages,
    )
    print_cost_summary()
    print(f"\nDone. {len(results)} total listings.")


if __name__ == "__main__":
    main()
