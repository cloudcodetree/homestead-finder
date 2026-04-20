# Rolling Context — Homestead Finder

> **For Claude:** Read this at the start of every session to understand current project state.
> Update the "Current Session" and "Recent Sessions" sections before ending each session.
> See `.claude/CLAUDE.md` for full project rules and conventions.

---

## Quick State Summary

| Item | Status |
|------|--------|
| Last Updated | 2026-04-20 |
| Current Phase | AI-enrichment pipeline shipped (local Max via `claude -p`) + real data flowing for LandWatch |
| Dashboard | AI filters, Top Picks view, Ask-Claude bar (dev-only), all CI-verified green |
| Scraper | LandWatch markdown parser working via Firecrawl; 125 real MT listings pulled in dry-run |
| GitHub Pages | Still not enabled in repo settings |
| Data | Real LandWatch scraping works (125 listings/state); other sources still need work |
| Notifications | SendGrid integrated but not configured |
| AI (local) | `claude -p` wrapper + enrich.py + curate.py + query_server.py all working with Max subscription |
| AI (CI) | Intentionally not running in CI — see ADR-012 |
| Firecrawl | `FIRECRAWL_API_KEY` in GitHub secrets; fallback chain working |

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
- **LandWatch Firecrawl+markdown parser** — site restructured to `/<state>-land-for-sale/page-N`; parser groups links by `/pid/<id>` and extracts title/address/price/acres/description. 25 listings/page, verified in CI: 125 MT listings retrieved successfully. Fixture-based tests at `scraper/tests/test_landwatch.py`.
- **Playwright install step** added to `.github/workflows/scrape.yml`.
- **Local AI pipeline** — billed against Claude Max subscription, runs on developer's machine:
  - `scraper/llm.py` — `claude -p` subprocess wrapper with on-disk cache keyed by (model, system, prompt) hash
  - `scraper/enrich.py` — per-listing enrichment (aiTags, homesteadFitScore, redFlags, aiSummary), idempotent via content hash, default model Haiku
  - `scraper/curate.py` — weekly Top Picks curation (ranked list with headline + reason per pick), default model Sonnet, single batched call
  - `scraper/query_server.py` — localhost-only HTTP proxy (stdlib, no deps) exposing `/health` and `/query` for natural-language re-ranking
- **Frontend AI UI:**
  - New Property fields: `aiTags`, `homesteadFitScore`, `redFlags`, `aiSummary`, `enrichedAt` (all optional)
  - FilterPanel "AI Insights" section: min-homestead-fit slider, hide-red-flags checkbox, aiTags multi-select (purple-themed)
  - PropertyCard: purple fit-score pill + red-flag count warning
  - PropertyDetail: dedicated AI Analysis panel with summary, red flags, tag chips
  - New "Picks" view-mode showing the curated list (loads `data/curated.json` with fallback to `sample-curated.json`)
  - "Ask Claude" bar in list view (auto-hidden when `query_server.py` isn't running — invisible in production)
  - New sort option: "Homestead Fit (AI)"

### Not Yet Done
- [x] ~~Real listing data flowing (need Firecrawl or Anthropic API key to bypass Cloudflare)~~ — **done for LandWatch** via Firecrawl
- [ ] Port the markdown-parser approach to `lands_of_america.py` (same Cloudflare block)
- [ ] GitHub Pages enabled on the repo
- [ ] SendGrid secrets configured
- [ ] BLM URLs updated (currently 404 — site restructured)
- [ ] County tax URLs audited (most are dead)
- [ ] Geocoding for listings without lat/lng
- [ ] Real server-side URL validation in scraper (see ADR-011)
- [ ] Run a real (non-dry-run) scrape to populate `data/listings.json` with LandWatch data
- [ ] First production enrich pass — `python -m scraper.enrich` against the real scrape output

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

### Session 6 — 2026-04-20
**What was done:** Shipped LandWatch real-data pipeline + full local-AI hybrid (enrichment, curation, NL query).

- **Scraping unblocked (LandWatch):**
  - Added `FIRECRAWL_API_KEY` to GitHub secrets
  - Discovered old URL format 404s; new pattern is `/<state>-land-for-sale[/page-N]`
  - Built markdown parser — groups `[text](url)` links by `/pid/<id>`, extracts title/address/price/acres
  - Added `playwright install chromium` to the CI workflow
  - Dry-run CI pulled 125 real MT listings (25/page × 5 pages) via Firecrawl
  - 10 fixture-based tests in `scraper/tests/test_landwatch.py`
  - Fixed "Valley County County" doubling bug

- **Decision:** user wanted AI for enrichment/filtering/ranking but doesn't want to pay for API credits on top of Max subscription. Researched Max → `claude -p` works locally against subscription, but NOT in GitHub Actions. Chose the hybrid architecture documented in **ADR-012**: CI does only parsing, local machine does all AI work via `claude -p`.

- **Phase A:** `scraper/llm.py` — `claude -p` subprocess wrapper with on-disk cache, structured JSON output, model override. Default Haiku.

- **Phase B (per-listing enrichment):**
  - `scraper/enrich.py` — calls Claude per listing against a controlled vocabulary (28 aiTags, 14 redFlags), idempotent via content hash
  - TS types extended with AITag, RedFlag, AI_TAG_LABELS, RED_FLAG_LABELS
  - FilterPanel "AI Insights" section with 3 controls
  - PropertyCard shows fit pill + red-flag count
  - PropertyDetail has dedicated AI Analysis panel
  - Sample-listings.json re-enriched for a complete demo

- **Phase C (curation):**
  - `scraper/curate.py` — two-stage: deterministic pre-rank (top 50 by 0.4·dealScore + 0.6·homesteadFit − 5·redFlags) → one Sonnet call picking top N with headline + reason
  - New `TopPicks` component with ranked cards
  - New "Picks" view-mode tab in top nav, loads `data/curated.json` with fallback to `sample-curated.json`

- **Phase D (natural-language query):**
  - `scraper/query_server.py` — stdlib-only localhost HTTP server, refuses to bind non-loopback without `--unsafe-any-host`
  - `/health` and `/query` endpoints with CORS limited to Vite dev ports
  - `useQueryServer` pings `/health` to gate the UI
  - `AskClaude` component — purple input bar that auto-hides when the server isn't running
  - Dashboard: when a query result is active, the list view replaces the filtered/sorted grid with Claude's ranked matches + inline reasons

- **CI:** both Python (ruff + pytest) and Frontend (tsc + eslint + build) workflows green on the final push.

**Decisions made:** ADR-012 — local-Max for AI, CI for parsing. Vocabularies manually kept in sync between Python and TypeScript.

**Commits:** `fix(scraper): update LandWatch to current URL format`, `fix: double County`, `fix: ruff lint`, `feat: AI enrichment pipeline`, `feat: AI-curated Top Picks`, `feat: natural-language query`.

---

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
| Other scrapers (lands_of_america, BLM, county tax) still return 0 | **High** | Only LandWatch has the new Firecrawl+markdown parser. Same approach should work for lands_of_america. |
| BLM URLs are 404 | Medium | blm.gov restructured — need to find new URLs |
| County tax URLs dead | Medium | DNS failures, SSL errors on most county sites |
| Missing lat/lng in most scrapers | Medium | Map shows 0,0 for many listings |
| AI vocabularies duplicated across Python and TS | Low | Kept in sync by hand (see ADR-012). Consider codegen later. |
| URL validation is stub only | Low | Client-side CORS blocks it; needs scraper-side impl (ADR-011) |
| NL query bar only works in `npm run dev` | By design | ADR-012 — `query_server.py` must be running locally. Production (Pages) hides the feature. |
