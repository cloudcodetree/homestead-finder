# Homestead Finder — Roadmap

## Phase 0: Foundation (DONE)
*Completed April 2026*

- [x] Project scaffold (React + TypeScript + Vite frontend, Python scraper)
- [x] Deal scoring engine with regional medians (38 tests passing)
- [x] Adaptive fetch strategy chain (HTTP → Playwright → Firecrawl → Claude)
- [x] AI learning pipeline (learned selectors, model escalation, cost tracking)
- [x] GovEase tax sale scraper (first live data source — 50 listings extracted)
- [x] Source registry (60+ government sources across 11 states)
- [x] Structured logging system
- [x] CI/CD workflows (scrape, deploy, test)
- [x] Frontend: property cards, filters, detail modal, sale type badges
- [x] DevContainer with Playwright + Chromium

## Phase 1: Real Data Flowing
*Target: April-May 2026*

### 1.1 More Platform Scrapers
- [ ] **PublicSurplus scraper** — covers most MN counties (tax-forfeited land)
- [ ] **State portal scrapers** — NM (centralized), CO (CCTPTA), MT (DNRC catalog)
- [ ] **Bid4Assets scraper** — covers ~11 WA counties + TX (needs Firecrawl for Cloudflare)
- [ ] GovEase detail page scraper — get acreage from individual parcel pages

### 1.2 Data Quality
- [ ] **Geocoding** via Nominatim (free) — make the map view usable
- [ ] **robots.txt checker** — verify compliance before scraping any source
- [ ] **Deduplication improvements** — cross-source matching by address/parcel
- [ ] Source URL health checker (`--validate-sources` CLI flag)

### 1.3 Scoring Improvements
- [ ] Tax sale scoring refinements (face value vs. assessed value)
- [ ] Regional median data update from USDA NASS
- [ ] Score calibration after seeing real deal distributions

### 1.4 Frontend Polish
- [ ] Map view: filter out 0,0 listings, cluster markers
- [ ] Sorting options (price, acreage, score, date)
- [ ] Mobile responsive improvements
- [ ] Loading skeleton states

**Milestone: 500+ real listings from 5+ sources across all 11 states**

## Phase 2: Smart & Automated
*Target: June-July 2026*

### 2.1 AI Integration
- [ ] Set up Anthropic API key for AI fallback
- [ ] Set up Firecrawl API key for Cloudflare-blocked sources
- [ ] Test AI learning pipeline against LandWatch (Cloudflare)
- [ ] Learned selectors working end-to-end
- [ ] Claude Batch API for 50% cost reduction on non-urgent extraction

### 2.2 Notifications
- [ ] Configure SendGrid secrets
- [ ] Email alerts for deals scoring 75+
- [ ] Weekly digest email with top deals per state
- [ ] Notification preferences (states, min score, max price)

### 2.3 Source Registry Expansion
- [ ] Add remaining counties for each target state
- [ ] Monthly automated URL health checks
- [ ] Track auction seasonality (when each county holds sales)
- [ ] Add federal sources (USDA, Forest Service inholdings, GSA surplus)

### 2.4 Data Persistence
- [ ] Evaluate Turso vs. continued JSON-in-git
- [ ] Historical price tracking (is this deal getting cheaper over time?)
- [ ] Listing lifecycle tracking (new → active → sold/expired)

**Milestone: Self-healing scraping, email notifications, 2,000+ listings**

## Phase 3: Product
*Target: August-September 2026*

### 3.1 User Features
- [ ] Saved searches (by state, features, price range)
- [ ] Watchlist (track specific parcels)
- [ ] Comparable sales analysis
- [ ] Tax sale calendar (upcoming auctions by state/county)

### 3.2 Data Enrichment
- [ ] Soil type overlay (USDA Web Soil Survey API)
- [ ] Flood zone data (FEMA)
- [ ] USDA plant hardiness zones
- [ ] Distance-from-amenities scoring (nearest town, hospital, grocery)
- [ ] Water rights lookup (western states)

### 3.3 Infrastructure
- [ ] Migrate to Turso/Supabase if listing count warrants it
- [ ] Move frontend to Vercel for faster deploys
- [ ] Parallel scraping across states (move off single GitHub Actions runner)

**Milestone: Full-featured dashboard, enriched data, user accounts**

## Phase 4: Scale (Future)
*No timeline — depends on traction*

- [ ] PWA (installable mobile app)
- [ ] More states (AK, AZ, UT, NV, WV, AR, MO, KY)
- [ ] Street view integration
- [ ] AI-generated property summaries
- [ ] Community features (reviews, tips, local knowledge)
- [ ] Revenue model evaluation (premium alerts, research reports)

## Decision Log

Major decisions are tracked in [context/DECISIONS.md](../context/DECISIONS.md).

## Current Sprint Focus

Track current work in [context/ROLLING_CONTEXT.md](../context/ROLLING_CONTEXT.md) and [context/BACKLOG.md](../context/BACKLOG.md).
