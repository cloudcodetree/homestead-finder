# Feature Backlog — Homestead Finder

> Priorities: P0 = must do now, P1 = next sprint, P2 = eventually, P3 = nice-to-have
> Update this file when items are completed or new ideas arise.
> Reference `context/DECISIONS.md` before implementing P1/P2 items.

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
