"""Main scraper orchestrator — runs all enabled sources and outputs listings.json."""

from __future__ import annotations

import argparse
import json
from datetime import date

import config
from logger import get_logger
from notifier import send_deal_alert, filter_hot_deals
from scoring import ScoringEngine
from sources.auction import AuctionScraper
from sources.blm import BLMScraper
from sources.county_tax import CountyTaxScraper
from sources.govease import GovEaseScraper
from sources.lands_of_america import LandsOfAmericaScraper
from sources.landwatch import LandWatchScraper
from sources.realtor import RealtorScraper
from sources.zillow import ZillowScraper

log = get_logger("main")

# Registry of all scrapers
ALL_SCRAPERS = {
    "landwatch": LandWatchScraper,
    "lands_of_america": LandsOfAmericaScraper,
    "zillow": ZillowScraper,
    "realtor": RealtorScraper,
    "county_tax": CountyTaxScraper,
    "auction": AuctionScraper,
    "blm": BLMScraper,
    "govease": GovEaseScraper,
}


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

    # Determine which scrapers to run
    active_scrapers = {
        name: cls
        for name, cls in ALL_SCRAPERS.items()
        if config.ENABLED_SOURCES.get(name, False)
        and (source_filter is None or name == source_filter)
    }

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

    # Write output
    output_path = config.DATA_DIR / "listings.json"
    output_path.write_text(json.dumps(scored, indent=2))
    print(f"\n  Written: {output_path} ({len(scored)} listings)")

    if config.SAVE_DATED_SNAPSHOT:
        snapshot_path = config.DATA_DIR / f"listings_{date.today().isoformat()}.json"
        snapshot_path.write_text(json.dumps(scored, indent=2))
        print(f"  Snapshot: {snapshot_path}")

    # Send notifications for new hot deals
    previously_seen = load_previously_seen()
    hot_deals = filter_hot_deals(scored, previously_seen=previously_seen)
    if hot_deals:
        print(f"\n  {len(hot_deals)} new hot deals — sending notification...")
        if send_deal_alert(hot_deals):
            # Mark as notified
            for deal in hot_deals:
                previously_seen.add(deal.get("id", ""))
            save_previously_seen(previously_seen)
    else:
        print("  No new hot deals above threshold.")

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
    args = parser.parse_args()

    if args.validate_selectors:
        validate_selectors()
        return

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
