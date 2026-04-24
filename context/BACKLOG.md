# Feature Backlog — Homestead Finder

> Priorities: P0 = must do now, P1 = next sprint, P2 = eventually, P3 = nice-to-have
> Update this file when items are completed or new ideas arise.
> Reference `context/DECISIONS.md` before implementing P1/P2 items.

---

## Product Vision (captured 2026-04-24 — the real ROI roadmap)

These are the features that transform the app from "better Zillow" into
"buy-side homestead research desk." Each entry includes the underlying
user need and the thinnest shippable v1.

- [ ] **Personalized home page** — when the user signs in, landing on
  the app shows 6-12 listings ranked by their personal model instead
  of the global feed. Thinnest v1: dedicated `/home` route that reuses
  `sortBy=recommended` + top-12 only, auto-hidden if no saves yet.
  Eventually: AI-generated "3 listings you should see today" with a
  one-sentence reason each.

- [ ] **User preference model / persona capture** — today's
  `user_ranking_weights` learns only from save/hide events; bootstrap
  problem for new users. v1: an onboarding sheet asking
  {budget, min acres, must-have features, move-in vs build, states,
  willing-travel-radius}. Persists to a new `user_preferences` table;
  blends into the ranking model as a prior until enough event data
  accrues to take over. Schema should be additive — preferences are
  durable settings, not events.

- [ ] **Saved searches as projects** — current saved-searches are
  stateless filter snapshots. Extend to "projects" with per-project:
  name, notes, listing shortlist (explicit pins beyond saved_listings),
  timeline of events (viewed, contacted seller, visited in person),
  status (scouting / shortlisted / offered / closed / abandoned).
  Turns the app into a pipeline tool, not a search tool. New
  `projects` table + `project_listings` join table.

- [ ] **User-tweakable AI prompts** — surface the enrichment + curation
  prompts as editable text in a settings panel. User can add their own
  criteria ("I care strongly about spring water and south-facing slope").
  The tweak gets appended to the system prompt when the user runs
  enrichment for themselves. Opens up power-user personalization without
  requiring code changes. Keep base vocabulary enums locked (output
  sanitization still clamps to them).

- [ ] **Draw-boundary map search** — Leaflet + leaflet-draw. User
  draws a polygon on the map; we filter listings whose lat/lng falls
  inside. Deal-breaker for buyers targeting specific watersheds, school
  districts, or commute zones. Dependency: leaflet-draw (~15KB gz).

- [ ] **Climate + threat scoring** — move beyond the FirstStreet
  external link to an integrated score. Pull from: NOAA SSP climate
  projections (30-year temperature + precipitation shifts), FEMA flood
  maps (already have), USDA drought outlook, wildfire WHP index, EPA
  AirNow historical PM2.5. Compose into a "Climate Risk" pill on the
  card (green/yellow/red) with a breakdown panel on the detail. Use
  existing `geoEnrichment.flood` as the template shape.

- [ ] **Emergency services proximity** — drive-time to the nearest:
  * Hospital (HHS/HRSA national hospitals geojson, free)
  * Trauma center by level (ACS Verified Trauma Centers public CSV)
  * Fire station (OSM Overpass `amenity=fire_station` — we already
    hit Overpass)
  * Sheriff / police (OSM `amenity=police`)
  * 911 PSAP location (NENA registry — state-level free CSVs)
  For a homestead buyer, "78 min to Level II trauma center" is
  often a hard go/no-go line. Surface as a stoplight pill on the
  card (green < 30 min, amber 30-60, red > 60).

- [ ] **Internet / broadband availability** — FCC Broadband Map API
  (`broadbandmap.fcc.gov/api`, free, no key) returns per-provider
  down/up speeds + technology (fiber / cable / DSL / fixed-wireless
  / satellite) at an exact lat/lng. Detail-page panel shows all
  available providers; card surfaces max-wired-down-speed as a
  "Best internet: 100Mbps fiber (Windstream)" chip. Missing provider
  coverage is a silent deal-breaker for remote-workers.

- [ ] **Community / demographic context** — blend several free
  sources into a "community score":
  * Census ACS 5-year block-group (age distribution, median
    income, housing tenure) via Census API (free key)
  * NCES school locator (public school within N miles, student-
    teacher ratio, graduation rate) — free CSV
  * OSM `amenity=place_of_worship`, `amenity=community_centre`,
    `amenity=library`
  * USDA farmers markets + CSAs directory (public API)
  Combine into: "Nearest school: 12 min · 3 churches + library
  within 10 mi · farmers market weekly · median age 47." Paints
  the "is there a there there" picture homesteaders ask about.

- [ ] **County voting patterns** — surface the political lean of the
  county where each listing sits. Relocation is as much a cultural
  decision as a financial one; buyers on both sides of the spectrum
  want to underwrite this explicitly before moving. Free data sources:
  * MIT Election Data & Science Lab — county-level presidential
    results 2000-2024 (maintained CSV, free)
  * Tony McGovern's `us-presidential-election-county-results` repo
    (alternative, same shape)
  * Harvard Dataverse mirrors for trend analysis
  * Census FIPS county codes for the join to our existing
    `location.county` + `location.state`
  Surface as: "Dem/Rep lean (last election) · 5-yr trend arrow ·
  turnout %." Detail panel can show the last 4 cycles as a mini
  chart. Framed factually (margin + trend) not editorially.

- [ ] **Property-as-stock analytics** — for each listing, compute +
  display the technical signals an investor would use:
  * Price trend over time (our daily scrape history provides this;
    need to start storing per-ID price snapshots)
  * Days-on-market percentile vs county
  * $/ac relative to county 12-mo rolling median (we have medians; add
    rolling)
  * "Similar parcels sold for X in the last 24 months" (county
    assessor API integration)
  * Velocity indicator — is this market heating up or cooling?
  New page: `/p/{id}/analytics` with charts. Uses Recharts (already
  likely a transitive dep).

---

## P0 — Immediate (Get to Working State)

- [ ] **Verify frontend builds** — `cd frontend && npm install && npm run build`
- [ ] **Verify Python tests pass** — `cd scraper && pytest tests/ -v`
- [ ] **Enable GitHub Pages** — Repo Settings → Pages → Source: GitHub Actions
- [ ] **Test scraper dry-run** — `python main.py --dry-run --source=landwatch --states=MT`
- [ ] **Generate package-lock.json** — Required for `npm ci` in CI

---

## P1 — Next Session

- [ ] **Port LandWatch markdown-parser approach to lands_of_america.py**
  - Same Cloudflare block, same Firecrawl fallback path available
  - Capture a sample Firecrawl markdown, identify listing-link pattern
  - Clone `parse_markdown_listings` + state URL slug logic
  - Add fixture-based tests

- [ ] **Run first production enrichment pass**
  - Non-dry-run scrape to populate `data/listings.json` with real LandWatch data
  - `python -m scraper.enrich` locally (burns ~30s per listing on Haiku)
  - Commit enriched `listings.json`
  - `python -m scraper.curate` for the first Top Picks
  - Commit `data/curated.json`

- [ ] **Server-side URL validation in scraper**
  - Add `scraper/utils/validator.py` — HTTP HEAD requests against listing URLs
  - Write `validated`, `validatedAt`, `status` fields back to each listing in `listings.json`
  - Mark new listings as `status: "unverified"` by default
  - Re-validate existing listings periodically (e.g., every 7 days)
  - See ADR-007 for architecture rationale

- [ ] **Geocoding for listings without lat/lng**
  - Use Nominatim (free OpenStreetMap geocoder)
  - Add `scraper/utils/geocoder.py`
  - Call in `BaseScraper.to_property()` when lat/lng is None
  - Cache results to avoid rate limits

- [ ] **Verify and fix scraper selectors**
  - LandWatch CSS selectors may have changed
  - Lands of America selectors may have changed
  - Test with: `python main.py --dry-run --source=landwatch --states=MT --max-pages=1`

- [ ] **Expand county tax sale coverage**
  - Add 10+ counties to `county_tax.py`
  - Focus on MT, ID, WY, TX initially
  - Document each county's URL and format

- [ ] **Fix GitHub Actions push step**
  - The `ad-hoc/push@v1` action in `scrape.yml` is a placeholder
  - Replace with `git push` directly or use proper action

- [ ] **Frontend: Deal score histogram**
  - Add a small sparkline/histogram above the filter panel
  - Shows score distribution of current results

---

## P2 — Future Features

- [ ] **Saved searches / watchlists**
  - Let user pin/star listings
  - Store in localStorage

- [ ] **Price history tracking**
  - Detect when a listing drops in price
  - Show price history on PropertyDetail
  - Store by listing ID across dated snapshots

- [ ] **Comparable sales**
  - Show recent land sales in the same county
  - Source: county assessor records (FOIA/public data)

- [ ] **Supabase migration**
  - When listings.json > 5MB or 500+ listings
  - See ADR-001 for migration trigger

- [ ] **Mobile PWA**
  - Add `manifest.json` and service worker
  - Enable offline viewing of last-loaded listings

- [ ] **Street view / satellite preview**
  - Link to Google Maps satellite view for each listing
  - No API key needed for simple links

- [ ] **Soil quality overlay**
  - USDA Web Soil Survey has public API
  - Show soil type on map hover

- [ ] **Flood zone overlay**
  - FEMA flood maps are public
  - Flag listings in flood zones

- [ ] **Distance from nearest town**
  - Calculate straight-line distance from listing to nearest town > 5k population
  - Add as a filter option

- [ ] **Multi-user support / sharing**
  - Share a filtered view via URL parameters
  - Encode filter state in URL hash

---

## P3 — Nice to Have

- [ ] Bulk export to CSV/spreadsheet
- [ ] Telegram bot notifications (alternative to email)
- [ ] Browser extension to detect land deals while browsing
- [ ] Integration with county GIS parcel maps
- [ ] AI-generated listing summary/red-flags
- [ ] Water rights database lookup (state-specific)
- [ ] Dark mode
- [ ] Filter by validation status (show only Verified, hide Expired)

---

## P2 — Images Phase 2: Detail-page Carousel

- [ ] **Per-listing gallery on PropertyDetail**
  - Phase 1 (shipped 2026-04-22): primary thumbnail via `PropertyThumbnail`
    component. LandWatch URLs synthesized from PID; HomesteadCrossing +
    OzarkLand scraped from cards directly. Direct hotlink → weserv
    fallback → placeholder.
  - Phase 2 scope: a swipeable 5-15 image carousel on the modal/page
    instead of a single hero image.
  - Requires: capturing the full gallery, which lives on per-listing
    detail pages (not search cards). Today `detail_fetcher.py` uses
    Firecrawl for LandWatch detail pages — but Firecrawl quota is
    expensive at 1490 listings/month. Rewrite against Playwright so
    it's free; ran ad-hoc once a week instead of daily.
  - HomesteadCrossing detail pages already render the gallery
    server-side (Rent Manager) — can extract via plain curl_cffi.
  - OzarkLand detail pages are WP, also server-rendered.
  - Frontend component: use a small carousel library (Swiper.js is
    the obvious choice) or ~50 lines of custom code; no need for a
    heavy dep.
  - Files touched: `scraper/detail_fetcher.py` (rework), new
    `scraper/sources/<source>_detail.py` per source, and a
    `<PropertyCarousel>` React component replacing the hero
    `PropertyThumbnail` call in `PropertyDetail.tsx`.

---

## P2 — OCR for scanned tax-sale PDFs

- [ ] **Wire OCR pipeline for MO Collector PDFs**
  - The 2025 Texas County MO Land Tax Sale PDF (the one already in
    tax_sale_registry.py) is fully image-scanned — pdfplumber
    returns zero text. Most MO Collectors publish scans.
  - Options:
    1. System tesseract + pdf2image/pypdfium2 (free, offline, ~10 min setup)
    2. Claude vision via `claude -p --image` (uses Max quota; easy
       one-listing-per-page prompt; high accuracy on typed text)
  - Blocks real MO tax-sale data until mid-July when 2026 lists
    publish. Currently missing ~50-80 Texas County parcels + similar
    from Reynolds + Douglas whenever their lists drop.
  - Files: scraper/sources/tax_sale_parser.py (`_missouri_collector_pdf`
    currently a scaffold)

---

## Deferred Sources (investigated, rejected — don't re-investigate)

Data collected 2026-04-22/23 during Ozark-pilot source expansion.
Keep this list so we don't burn time re-probing channels that were
already ruled out. Reconsider only if the underlying site structure
or MO/AR inventory density changes materially.

- **FSBO.com** — 6 MO + AR land listings across entire site (per
  sitemap.xml); Next.js SPA, no API; Playwright required. Cost-benefit
  is <10 relevant listings for a stateful scraper.
- **US Marshals asset sales** — 0 MO + 1 AR (suburban house) active
  nationwide at time of probe. Historical rate <1 MO/AR rural land
  listing/year. Channel is usmarshals.gov + bid4assets + CWS, all
  Cloudflare-gated SPAs. Email digest is the right integration, not
  scraping.
- **FSA Resales (USDA farm surplus)** — no centralized feed. Program
  now operates via per-state-office press releases; state office
  pages (`fsa.usda.gov/state-offices/{missouri,arkansas}`) have
  zero inventory-property links. Scraping requires ad-hoc state-by-
  state crawling with unpredictable schema. Defer until/unless USDA
  restores a national inventory database.
- **Facebook Marketplace** — login wall + aggressive anti-bot;
  scraping violates TOS. No API for land category.
- **PACER bankruptcy records** — paid access ($0.10/page), no
  structured real-estate-only feed. Rural land in bankruptcy estate
  is a single-digit fraction of filings. Not worth the dev cost.
- **LandFlip.com / Land And Farm / Land.com / farmandranch.com / landsearch.com**
  — all 403 on plain HTTP (Cloudflare). Inventory overlaps LandWatch
  heavily (Land.com family). Not worth Playwright cost.

---

## Tech Debt

- [ ] **Tune Overpass (OpenStreetMap) rate-limit handling in proximity enrichment**
  - Current behavior: 176-listing backfill at `concurrency=2` still 429s on
    a meaningful fraction of `lookup_proximity` calls. The code handles
    failures gracefully (treats missing data as unknown, not zero) so
    soil/flood/elevation/watershed still reach 100% coverage, but proximity
    (nearest-town distance + named water features) ends up missing on
    roughly 20-30% of rows.
  - Options to evaluate:
    - Raise the internal sleep in `lookup_proximity` from 1.2s → 2.5s
      between the town + water queries (same wall clock at concurrency=2,
      fewer 429s)
    - Drop default concurrency to 1 in `enrich_geo` (doubles wall clock
      from ~9min → ~18min for 176 listings but zero 429s)
    - Add exponential-backoff retry on 429 inside `_post_overpass` (costs
      a bit of latency per retry, recovers most missing rows)
    - Self-host an Overpass instance (unlimited queries but needs 50GB+
      OSM pbf + a VPS — only worth it past ~5k listings)
  - Files: [scraper/enrichment/proximity.py](scraper/enrichment/proximity.py),
    [scraper/enrich_geo.py](scraper/enrich_geo.py)
  - Non-urgent — partial proximity coverage is still useful for the
    homestead-fit score, and the gap is in the nice-to-have layer rather
    than the gating layer (soil/flood).

---

## Completed

- [x] **LandWatch Firecrawl+markdown parser** — restored real data flow, 125 MT listings verified in CI (2026-04-20)
- [x] **AI enrichment pipeline** — `scraper/enrich.py` with 28 aiTags / 14 redFlags / fit score / summary, idempotent, local Max (2026-04-20)
- [x] **AI curation** — `scraper/curate.py` produces `data/curated.json` with ranked picks + reasoning (2026-04-20)
- [x] **Top Picks dashboard view** — new view-mode showing curated picks with headlines + reasons (2026-04-20)
- [x] **Natural-language query proxy** — localhost-only `scraper/query_server.py` + "Ask Claude" bar that auto-hides in production (2026-04-20)
- [x] **ADR-012** — local-Max for AI, CI for parsing (2026-04-20)
- [x] Project scaffolding (2024-01-15)
- [x] Frontend: Dashboard, Map, List, Filters, PropertyDetail, Notifications (2024-01-15)
- [x] Scraper: Base class, 7 sources, scoring engine, notifier (2024-01-15)
- [x] GitHub Actions: scrape cron, Pages deploy, test CI (2024-01-15)
- [x] Claude Code config: CLAUDE.md, skills, agents, commands, hooks (2024-01-15)
- [x] Rolling context system (this file + ROLLING_CONTEXT.md + DECISIONS.md) (2024-01-15)
- [x] DevContainer for Codespaces (2024-01-15)
- [x] Listing validation system — `validated`, `validatedAt`, `status` fields on Property type (2026-04-06)
- [x] Validation status badges (Verified / Unverified / Expired) on PropertyCard and PropertyDetail (2026-04-06)
- [x] URL display on PropertyDetail — clickable link, copy button, tooltip (2026-04-06)
- [x] `validateListingUrl` utility stub in `frontend/src/utils/validation.ts` (2026-04-06)
- [x] Sample listings marked `status: "unverified"` (2026-04-06)
- [x] Collapsible desktop filter sidebar with smooth CSS transition (2026-04-06)
- [x] Mobile filter drawer (slide-from-left, backdrop, floating FAB button) (2026-04-06)
- [x] Sort-by dropdown in list view (6 sort options) (2026-04-06)
