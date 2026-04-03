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

---

## Completed

- [x] Project scaffolding (2024-01-15)
- [x] Frontend: Dashboard, Map, List, Filters, PropertyDetail, Notifications
- [x] Scraper: Base class, 7 sources, scoring engine, notifier
- [x] GitHub Actions: scrape cron, Pages deploy, test CI
- [x] Claude Code config: CLAUDE.md, skills, agents, commands, hooks
- [x] Rolling context system (this file + ROLLING_CONTEXT.md + DECISIONS.md)
- [x] DevContainer for Codespaces
