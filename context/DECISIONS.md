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
