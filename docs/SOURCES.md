# Homestead Finder — Source Strategy

## The Insight

Instead of scraping 700+ individual county websites, we scrape **~6 auction platforms** that aggregate counties. This covers ~60-70% of sources with minimal scraper development.

```
6 platform scrapers     → ~60-70% of counties
State portal scrapers   → ~15-20% more
AI fallback on custom   → ~10% more
Remaining (in-person)   → can't scrape, monitor manually
```

## Source Categories

### Tier 1: Tax Sales (Best Deals)
Properties sold for unpaid taxes. Face values often $100-$5,000 for land worth $10K-$100K+.

| Type | What you get | Redemption risk |
|------|-------------|-----------------|
| **Tax Deed** (MT, ID, OR, TX, TN, WA, NM) | Actual property | Low — deed is final or short redemption |
| **Tax Lien** (CO, WY, ME) | Certificate earning 10-18% interest | Medium — owner can redeem within 1-4 years |
| **Tax Forfeiture** (MN) | Property forfeited to state | None — state owns it, selling it |

### Tier 2: State Land Sales
State agencies selling trust land, surplus, or conservation disposals.

- MT: DNRC Trust Lands (searchable catalog)
- MN: DNR 5.6M acres (auctions via MNBid)
- TX: GLO 13M acres (periodic sales)
- OR: Dept of State Lands
- WA: DES surplus properties

### Tier 3: Commercial Listings (Supplementary)
LandWatch, Lands of America — useful for market comparison but:
- Cloudflare-blocked (need Firecrawl/Claude)
- ToS likely prohibits scraping
- Not where the best deals are

## Platform Priority

| # | Platform | robots.txt | Our states | Scraper status | County coverage |
|---|----------|-----------|------------|----------------|-----------------|
| 1 | **GovEase** | Permissive | CO, TN, TX, WA | **DONE** | 28 counties |
| 2 | **PublicSurplus** | Permissive | MN, WA | Not started | Most MN counties |
| 3 | **Bid4Assets** | Cloudflare | WA, TX, NM | Not started | 100+ counties |
| 4 | **RealAuction** | Cloudflare | CO, ID | Not started | 11 states |
| 5 | **MNBid** | Gov site | MN | Not started | State DNR land |
| 6 | **Grant Street** | Permissive | (CA, FL mostly) | Not started | ~30 jurisdictions |
| 7 | **CivicSource** | Permissive | (LA mostly) | Not started | ~20 parishes |
| 8 | **GovDeals** | Cloudflare | Various | Not started | Surplus only |

## State-by-State Scraping Difficulty

| Difficulty | States | Strategy |
|-----------|--------|----------|
| **Easy** (centralized portal) | MN, NM | One scraper per state covers everything |
| **Medium** (platform-dominated) | CO, WA, TN | GovEase + RealAuction cover most counties |
| **Medium** (master list exists) | OR | Tillamook County maintains all URLs |
| **Fragmented** (many platforms) | TX | Bid4Assets + GovEase + MVBA + county sites |
| **Hard** (mostly in-person) | MT, ID, WY | State land office + a few online counties |
| **Hard** (municipal-level) | ME | 2024 law requires realtor listings, not auctions |

## Tax Sale Seasonality

Most county tax sales happen on a predictable schedule:

| State | Typical timing | Notes |
|-------|---------------|-------|
| CO | Oct-Nov | Tax lien sales, CCTPTA publishes all dates |
| TX | 1st Tuesday of every month | Year-round |
| TN | Varies by county | Check GovEase for active auctions |
| WA | Varies | Bid4Assets announces dates |
| MN | Periodic | Counties post on PublicSurplus when ready |
| MT | Jul-Aug | In-person at courthouse |
| ID | Sep | Kootenai on RealAuction |
| WY | Jul-Aug | After Frontier Days (Laramie County) |
| NM | Year-round | State schedules as title research completes |
| OR | Varies | County-by-county |
| ME | Varies | Municipal-level |

## Source Registry

All known sources are catalogued in `data/source_registry/`:

```
data/source_registry/
├── registry.json          ← Master index (8 platforms + 11 state portals)
└── states/
    ├── CO.json            ← 3 state + 3 county sources
    ├── ID.json            ← 1 state + 4 county sources
    ├── ME.json            ← 1 state + 2 municipal sources
    ├── MN.json            ← 3 state + 5 county sources
    ├── MT.json            ← 2 state + 3 county sources
    ├── NM.json            ← 2 state + 3 county sources
    ├── OR.json            ← 2 state + 5 county sources
    ├── TN.json            ← 1 state + 4 county sources
    ├── TX.json            ← 3 state + 4 county sources
    ├── WA.json            ← 5 state + 9 county sources
    └── WY.json            ← 1 state + 4 county sources
```

Total: **60+ sources catalogued**, growing as we discover more counties.

## Adding a New Source

See `.claude/skills/scraper-dev/SKILL.md` for the full process.

Quick version:
1. Check robots.txt
2. Add entry to `data/source_registry/states/<STATE>.json`
3. If it uses an existing platform (GovEase, etc.) — just add the county to the platform scraper's county list
4. If it's a custom site — the AI learning pipeline can often handle it without writing a new scraper
5. If AI can't handle it — create `scraper/sources/<name>.py` extending `BaseScraper`
