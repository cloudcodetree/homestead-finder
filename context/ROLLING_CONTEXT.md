# Rolling Context — Homestead Finder

> **For Claude:** Read this at the start of every session to understand current project state.
> Update the "Current Session" and "Recent Sessions" sections before ending each session.
> See `.claude/CLAUDE.md` for full project rules and conventions.

---

## Quick State Summary

| Item | Status |
|------|--------|
| Last Updated | 2026-04-05 |
| Current Phase | Adaptive scraping system built, testing against live sites |
| Dashboard | Working locally (Vite dev server), builds clean |
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

### Not Yet Done
- [ ] Real listing data flowing (need Firecrawl or Anthropic API key to bypass Cloudflare)
- [ ] GitHub Pages enabled on the repo
- [ ] SendGrid secrets configured
- [ ] BLM URLs updated (currently 404 — site restructured)
- [ ] County tax URLs audited (most are dead)
- [ ] Geocoding for listings without lat/lng

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

## Architecture Decisions Made This Session

- **ADR-007**: Playwright over Selenium for browser strategy (faster, better anti-detection, same binary serves dev + CI)
- **ADR-008**: AI learning pipeline with cached selectors — AI discovers CSS selectors on first failure, caches them for subsequent runs at zero cost
- **ADR-009**: Model escalation chain (Haiku→Sonnet→Opus) with per-task tier caps and daily budget limits
- **ADR-010**: Structured logging via Python `logging` module to both stdout and `data/scraper.log`

---

## Open Questions

1. **API keys needed** — Firecrawl and/or Anthropic API keys to activate fallback strategies
2. **LandWatch API** — may have an undocumented `/__api/` endpoint (worth investigating)
3. **BLM URLs** — need to find current blm.gov URL structure
4. **County tax coverage** — most hardcoded URLs are dead. Consider a different approach (state-level databases?)
5. **Geocoding** — still needed. Nominatim is free.

---

## Recent Sessions

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

**Decisions made:**
- Use Playwright instead of Selenium (better anti-detection, headless shell works in containers)
- Strategy chain is per-source, configured in config.py
- AI costs capped at $1/run, learned selectors eliminate repeat AI calls
- Git-commit state persistence is fine for Tier 0, Supabase for Tier 1

**Next priorities:**
1. Set up Firecrawl or Anthropic API key to test AI fallback against live LandWatch
2. Update BLM URLs to current site structure
3. Investigate LandWatch undocumented API
4. Enable GitHub Pages

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
