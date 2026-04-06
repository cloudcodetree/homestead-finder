# Rolling Context — Homestead Finder

> **For Claude:** Read this at the start of every session to understand current project state.
> Update the "Current Session" and "Recent Sessions" sections before ending each session.
> See `.claude/CLAUDE.md` for full project rules and conventions.

---

## Quick State Summary

| Item | Status |
|------|--------|
| Last Updated | 2026-04-06 |
| Current Phase | UI polish + validation system added on top of adaptive scraping |
| Dashboard | Working locally; builds clean; validation badges, collapsible filters, sort-by added |
| Scraper | Adaptive strategy chain built (HTTP→Playwright→Firecrawl→Claude AI) |
| GitHub Pages | Not yet enabled in repo settings |
| Data | Sample data only — real scraping blocked by Cloudflare on main sources |
| Notifications | SendGrid integrated but not configured |
| AI Learning | Pipeline built — needs API keys to activate (ANTHROPIC_API_KEY, FIRECRAWL_API_KEY) |

---

## What's Built

### Completed
- Full React + TypeScript frontend (Dashboard, Map, Filters, PropertyCard, PropertyDetail, Notifications)
- **Adaptive fetch strategy chain** (`scraper/strategies/`) — HTTP → Playwright browser → Firecrawl → Claude extraction
- **AI learning pipeline** (`scraper/ai/`) — learned selectors, model escalation (Haiku→Sonnet→Opus), cost tracking
- Deal scoring engine with regional medians (38 tests, all passing)
- Structured logging system (`scraper/logger.py` → stdout + `data/scraper.log`)
- GitHub Actions workflows (scrape, deploy, test) with Chrome setup and API key secrets
- DevContainer with Playwright + Chromium pre-installed
- Claude Code config (.claude/ with skills, agents, commands)
- TypeScript build errors fixed (Dashboard, FilterPanel, MapView)
- scrape.yml push step fixed (was using placeholder action)
- **Listing validation UI** — `validated`, `validatedAt`, `status` fields on Property type; status badges (Verified / Unverified / Expired) on PropertyCard and PropertyDetail
- **URL display on PropertyDetail** — Clickable truncated link, clipboard copy button with "Copied!" feedback, tooltip showing full URL
- **Validation utility stub** — `frontend/src/utils/validation.ts` with `validateListingUrl()` stub + CORS explanation comment
- **Collapsible desktop filter sidebar** — `‹/›` toggle, smooth `transition-[width]` CSS animation to 40px strip
- **Mobile filter drawer** — Slides from left with backdrop overlay; floating green FAB "Filters (N)" button
- **Sort-by dropdown** — 6 sort options (Best Deal, Price, Price/Acre, Acreage, Newest); persists in state
- Sample data: all 10 listings marked `status: "unverified"`

### Not Yet Done
- [ ] Real listing data flowing (need Firecrawl or Anthropic API key to bypass Cloudflare)
- [ ] GitHub Pages enabled on the repo
- [ ] SendGrid secrets configured
- [ ] BLM URLs updated (currently 404 — site restructured)
- [ ] County tax URLs audited (most are dead)
- [ ] Geocoding for listings without lat/lng
- [ ] Real server-side URL validation in scraper (see ADR-011)

---

## Live Testing Results (2026-04-05)

| Source | HTTP | Playwright | Firecrawl | Claude AI | Status |
|--------|------|-----------|-----------|-----------|--------|
| LandWatch | 403 | 403 (Cloudflare) | untested (no key) | untested (no key) | Blocked |
| Lands of America | 403 | untested | untested | untested | Blocked |
| BLM | 404 | N/A | untested | untested | URLs stale |
| County Tax | DNS/SSL errors | untested | untested | untested | URLs dead |
| Auction (Hubzu) | 0 results | untested | untested | untested | Needs JS |

**Key finding:** LandWatch blocks even headless Playwright — Cloudflare detects headless browsers. Firecrawl or direct Claude extraction are the most likely paths to real data.

---

## Open Questions

1. **API keys needed** — Firecrawl and/or Anthropic API keys to activate fallback strategies
2. **LandWatch API** — may have an undocumented `/__api/` endpoint (worth investigating)
3. **BLM URLs** — need to find current blm.gov URL structure
4. **County tax coverage** — most hardcoded URLs are dead. Consider a different approach (state-level databases?)
5. **Geocoding** — still needed. Nominatim is free.
6. **URL validation cadence** — How often should the scraper re-validate existing listing URLs? Daily? Only on scrape runs?

---

## Current Priorities (see BACKLOG.md for full list)

1. **Get real data flowing** — Set up FIRECRAWL_API_KEY or ANTHROPIC_API_KEY in GitHub secrets
2. **Enable GitHub Pages** — Repo Settings → Pages → Source: GitHub Actions
3. **Update BLM URLs** — Find current blm.gov land sale URL structure
4. **Add geocoding** — Most scrapers don't return lat/lng (Nominatim is free)
5. **Implement server-side URL validation** — Add `scraper/utils/validator.py`, write `validated`/`validatedAt`/`status` back to listings (see ADR-011)

---

## Recent Sessions

### Session 4 — 2026-04-06
**What was done:** UI feature additions — listing validation system, collapsible filters, sort-by.
- Added `validated`, `validatedAt`, `status` fields to `Property` type
- All 10 sample listings marked `status: "unverified"`
- Created `frontend/src/utils/validation.ts` stub with CORS limitation comment
- Added `ValidationBadge` to `PropertyCard` and `PropertyDetail`
- Added URL display section to `PropertyDetail` (clickable link, clipboard copy, tooltip)
- Updated "View Full Listing" CTA: unverified warning, expired gray styling
- Collapsible desktop sidebar: `‹/›` toggle, smooth CSS width transition to 40px strip
- Mobile filter drawer: slides from left with backdrop, floating FAB "Filters (N active)"
- `FilterPanel` gained `hideHeader` prop
- Sort-by dropdown in list view: 6 options, state-managed, applies immediately
- Updated BACKLOG, DECISIONS (ADR-011), README

**Decisions made:** ADR-011 — split URL validation between frontend badges (now) and server-side scraper (future, avoids CORS).

### Session 3 — 2026-04-06
**What was done:** Debugged "0 listings" on GitHub Pages.
**Root cause:** `data/listings.json` in the repo root was `[]` (scraper ran but found no results). The fetch succeeded with an empty array, so the fallback to `sample-listings.json` never triggered. Secondary issue: `fetch('./data/listings.json')` used a relative URL that could misresolve under the `/homestead-finder/` base path.
**Fix:** `frontend/src/hooks/useProperties.ts` — added `fetched.length === 0` check to trigger sample-data fallback; changed fetch URL to `import.meta.env.BASE_URL + 'data/listings.json'`. Pushed directly to main (commit `f77f3d1`), deploy triggered automatically.
**Next priority:** Figure out why scrapers return empty data (`[]`) — likely Cloudflare blocks still, need API keys.

### Session 2 — 2026-04-05
**What was done:**
- Fixed P0 items: TypeScript build errors, Python tests verified (20/20), scrape.yml push action fixed
- Built complete adaptive scraping system:
  - `scraper/strategies/` — FetchStrategyChain, HTTP, Playwright browser, Firecrawl, Claude extraction
  - `scraper/ai/` — AILearningPipeline, ModelEscalator, LearnedSelectorManager, cost tracking
  - Updated BaseScraper with `fetch_page()`, `_try_ai_fallback()`, AI-aware `scrape()`
  - Added `--no-ai`, `--ai-max-tier`, `--validate-selectors` CLI flags
  - 18 new tests (38 total, all passing)
- Added structured logging system
- Updated devcontainer with Playwright + Chromium
- Tested against live sites — Cloudflare blocks HTTP and headless browser on LandWatch
- Updated CI/CD with Chrome setup, new secrets, cost artifact upload

### Session 1 — 2024-01-15
**What was done:** Initial project scaffolding. Created all files per spec.

---

## Known Issues / Blockers

| Issue | Severity | Notes |
|-------|----------|-------|
| All scrapers return 0 listings | **High** | Need Firecrawl/Anthropic API keys to bypass Cloudflare |
| BLM URLs are 404 | Medium | blm.gov restructured — need to find new URLs |
| County tax URLs dead | Medium | DNS failures, SSL errors on most county sites |
| Missing lat/lng in most scrapers | Medium | Map shows 0,0 for many listings |
| No API keys configured | Medium | Need FIRECRAWL_API_KEY and/or ANTHROPIC_API_KEY |
| URL validation is stub only | Low | Client-side CORS blocks it; needs scraper-side impl (ADR-011) |
