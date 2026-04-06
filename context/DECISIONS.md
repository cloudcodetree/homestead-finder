# Architecture Decision Records (ADRs)

> Major technical decisions for Homestead Finder. Add a new entry whenever a significant
> architectural choice is made. Reference this before proposing changes that touch architecture.

---

## ADR-001: JSON Files as Initial Data Store

**Date:** 2024-01-15
**Status:** Accepted

**Context:** Need a data layer that works with GitHub Pages (static hosting). Could use Supabase, Airtable, or JSON files.

**Decision:** Start with JSON files committed to the repo (`data/listings.json`). GitHub Actions scraper writes them, GitHub Pages serves them as static assets.

**Consequences:**
- (+) Zero infrastructure cost, zero setup
- (+) Works perfectly with GitHub Pages
- (+) Version history of all listings via git
- (-) No real-time updates, no server-side filtering
- (-) Limited scalability (file size grows over time)
- (?) Migration path: when listings.json > ~5MB or filtering becomes slow, migrate to Supabase

**Migration trigger:** > 500 listings or noticeable frontend performance degradation.

---

## ADR-002: Vite Over Create React App

**Date:** 2024-01-15
**Status:** Accepted

**Context:** Need a React + TypeScript build tool. CRA is deprecated, Vite is the current standard.

**Decision:** Use Vite 5 with `@vitejs/plugin-react`.

**Consequences:**
- (+) Fast HMR, modern tooling
- (+) Native ESM, better tree-shaking
- (+) TypeScript support out of the box
- (-) Base path config required for GitHub Pages (`base: '/homestead-finder/'`)

---

## ADR-003: Scoring Weights

**Date:** 2024-01-15
**Status:** Accepted — revisit after 30 days of real data

**Context:** Need a formula to score deal quality. Multiple factors: price, features, market time, source.

**Decision:**
- Price vs. regional median: 40% (dominant factor)
- Homesteading features: 30%
- Days on market: 20%
- Source reliability: 10%

**Rationale:** Price per acre vs. regional median is the most objective measure of deal quality. Features are highly subjective but water access is non-negotiable for homesteading, hence high weight. DOM reflects seller motivation.

**Revisit:** After seeing real score distributions. If too many listings cluster in 40-60 range, adjust curve.

---

## ADR-004: Tailwind CSS Over CSS Modules

**Date:** 2024-01-15
**Status:** Accepted

**Context:** Need a styling approach for the React frontend.

**Decision:** Tailwind CSS v3 utility classes.

**Consequences:**
- (+) Fast to build UI without switching files
- (+) Consistent design system
- (-) Verbose JSX — acceptable tradeoff given project size
- (-) Learning curve if contributor is new to Tailwind

---

## ADR-005: No Geocoding Service at Launch

**Date:** 2024-01-15
**Status:** Accepted — revisit

**Context:** Many scraped listings won't have lat/lng coordinates. The map is a key feature.

**Decision:** Skip geocoding at launch. Listings without lat/lng show at 0,0 (off map). Map still useful for listings that do have coordinates (BLM, some county tax sales).

**Revisit:** Add Nominatim (OpenStreetMap geocoder, free) when > 50% of listings are missing coordinates. Implementation: `requests.get("https://nominatim.openstreetmap.org/search?q={county}+county+{state}&format=json")`.

---

## ADR-006: Rolling Context System

**Date:** 2024-01-15
**Status:** Accepted

**Context:** Project will be worked on across multiple Claude Code sessions, potentially on different machines (local, Codespace, Claude Desktop). Need session continuity.

**Decision:** Maintain `context/` directory with:
- `ROLLING_CONTEXT.md` — Current state, session notes, priorities
- `DECISIONS.md` — This file
- `BACKLOG.md` — Feature backlog

Claude's `.claude/CLAUDE.md` instructs it to read/update these files each session.

**Consequences:**
- (+) Full context available on any machine by cloning the repo
- (+) Works in Codespaces, Claude Desktop, Claude Code CLI
- (-) Requires discipline to update at session end
- (-) Context can become stale if not maintained

---

## ADR-007: Playwright Over Selenium for Browser Strategy

**Date:** 2026-04-05
**Status:** Accepted

**Context:** Need a headless browser to render JS-heavy sites and bypass simple bot detection. Selenium was already in requirements.txt but required a system Chrome install and ChromeDriver version matching.

**Decision:** Use Playwright as the browser automation layer instead of Selenium.

**Consequences:**
- (+) Playwright's `install --with-deps` handles both browser binary and system libs
- (+) Better anti-detection out of the box (patches `navigator.webdriver`)
- (+) Headless shell works in containers/Codespaces without full Chrome
- (+) Faster than Selenium for page rendering
- (-) Additional 110MB download for Chromium binary
- (?) Selenium still in requirements.txt for backward compat — remove if never used

---

## ADR-008: AI Learning Pipeline with Cached Selectors

**Date:** 2026-04-05
**Status:** Accepted

**Context:** All 5 scraper sources fail (403, 404, DNS errors). Hardcoded CSS selectors break when sites change HTML. Need a system that adapts without manual maintenance.

**Decision:** Build a 3-tier AI learning pipeline:
1. Try cached "learned selectors" (free, from prior AI runs)
2. Use Claude to discover new selectors from raw HTML (paid once, cached for future)
3. Use Claude for direct listing extraction (paid per page, last resort)

Learned selectors are stored in `data/learned_selectors/<source>.json` and committed to git.

**Consequences:**
- (+) Self-healing: system adapts when sites change HTML without code changes
- (+) Cost-efficient: AI pays once to learn, selectors reused for free on subsequent runs
- (+) Gradual degradation: each tier is a fallback, not a hard dependency
- (-) Adds complexity to BaseScraper
- (-) Learned selectors in git feels odd, but works for Tier 0
- (?) Monitor selector longevity — if sites change weekly, AI costs add up

---

## ADR-009: Model Escalation Chain (Haiku → Sonnet → Opus)

**Date:** 2026-04-05
**Status:** Accepted

**Context:** Using Claude API for scraping tasks — need to balance cost vs. capability.

**Decision:** Start each AI task with the cheapest model that can handle it, escalate only on failure:
- Listing extraction: Haiku (start) → Sonnet (max)
- Selector discovery: Sonnet (start) → Opus (max)
- Data validation: Haiku only

Daily budget cap: $1.00/run. Cost tracked in `data/ai_costs.json`.

**Consequences:**
- (+) Typical daily run costs $0-0.05 (Haiku + cached selectors)
- (+) Opus only used for genuinely hard cases (~$0.60/call)
- (-) Model escalation adds latency on failure paths
- (?) Haiku may be good enough for everything — monitor escalation frequency

---

## ADR-010: Structured Logging System

**Date:** 2026-04-05
**Status:** Accepted

**Context:** Scraper runs in GitHub Actions — need to debug failures after the fact without watching stdout live.

**Decision:** Use Python's `logging` module with dual output: stdout (INFO) + file (`data/scraper.log`, DEBUG). All components use `from logger import get_logger` with hierarchical names (e.g., `scraper.landwatch`, `ai.learning`).

**Consequences:**
- (+) Timestamps, log levels, and structured context on every line
- (+) `data/scraper.log` available as git artifact for debugging
- (-) Slightly more verbose than bare `print()` calls

---

## ADR-011: Client-Side Validation Badges, Server-Side URL Checking

**Date:** 2026-04-06
**Status:** Accepted

**Context:** Users need to know whether a listing URL is still live (active), has gone 404 (expired), or hasn't been checked yet (unverified). The React frontend is static (GitHub Pages) and cannot make cross-origin HTTP requests to arbitrary listing URLs due to browser CORS policy. A proxy or serverless function would add infrastructure complexity.

**Decision:** Split the validation concern in two:

1. **Frontend (done now):** Display-only status badges on each card and in the detail view. The `Property` type gains `validated?: boolean`, `validatedAt?: string`, and `status?: "active" | "expired" | "unverified"`. The `validateListingUrl()` utility in `frontend/src/utils/validation.ts` is a documented stub — it exists for the future but does nothing client-side.

2. **Backend (future):** The Python scraper (`scraper/utils/validator.py`, not yet built) will issue HTTP HEAD requests against each listing URL and write `validated`, `validatedAt`, and `status` back to `listings.json` as part of the daily scrape run.

**Consequences:**
- (+) Zero added infrastructure — validation piggybacks on the existing GitHub Actions scraper
- (+) Frontend already has the full UI ready to consume validation data
- (+) No CORS issues — scraper runs server-side in GitHub Actions
- (-) Validation data is at most 24 hours fresh (only updated on scrape runs)
- (-) New listings start as `unverified` until the next scrape cycle validates them
- (?) May want configurable re-validation interval (e.g., check active listings every 7 days, expired ones monthly)

---

## Template for New ADRs

```markdown
## ADR-NNN: [Title]

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNN

**Context:** [What problem are we solving? What are the constraints?]

**Decision:** [What did we decide?]

**Consequences:**
- (+) [Positive consequences]
- (-) [Negative consequences / tradeoffs]
- (?) [Uncertain outcomes]
```
