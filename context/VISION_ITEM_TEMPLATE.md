# Vision Item Template

Each vision item (homestead-finder is doing 16 of these) tends to follow
the same shape. This template is the codified version so we don't keep
reinventing the wheel — every vision item adds these layers:

1. **Data source** — where the raw signal comes from (free public API,
   scraped CSV, Census, FCC NBM, FEMA, etc.)
2. **Scraper enrichment** — a Python module that walks listings, looks
   up the signal by lat/lng or county, and stamps it onto the row
3. **Property field** — a typed sidecar object on `Property` (TS type
   declared in `frontend/src/types/property.ts`)
4. **UI surface** — a panel on `PropertyDetail`, a chip on
   `PropertyCard`, a filter, or a composite score in `dealScore`
5. **Tests** — vitest for any non-trivial computation; pytest for the
   enrichment

Use the **Recipe** section as a checklist when starting an item. The
**Recent examples** section shows what a finished item looks like end-
to-end so you have a real diff to copy.

---

## Recipe

For every vision item, in order:

### 1. Pick the data shape

Start with the **smallest** structured representation that lets the UI
surface a clear answer. Prefer one numeric score + one or two human
labels over dumping a dozen raw fields.

```ts
// EXAMPLE — Vision #11 (county voting):
export interface VotingPattern {
  /** Year of the election the data is from. */
  year: number;
  /** Democratic vote share (0–100). */
  dPct: number;
  /** Republican vote share (0–100). */
  rPct: number;
  /** Margin in pp; positive = R, negative = D. */
  margin: number;
}
```

Add the field to `Property` as **optional** so older rows that haven't
been enriched don't fail the type check:

```ts
export interface Property {
  // … existing fields …
  votingPattern?: VotingPattern;  // populated by scraper.enrichment.voting
}
```

### 2. Build the scraper enrichment

Create `scraper/enrichment/<feature>.py`. Every enrichment module is a
single `enrich(listings: list[Property]) -> int` function that:

- Iterates the corpus
- Looks up the signal for each listing's `(state, county)` or `(lat, lng)`
- Stamps it onto the row (mutates in place)
- Returns the count of rows it touched
- **Skips** rows that already have the field (idempotent — safe to re-run)
- **Throttles** any per-row network call to ~1 req/sec (per the
  never-blacklisted memory rule)

Wire it into `scraper/main.py` after the JSON write so it runs every
scrape. Gate behind an env var (e.g. `SKIP_VOTING=1`) for fast
iteration.

### 3. Surface it in the UI

Three default surfaces; pick at least one. Multi-surface items should
share a single new component:

| Surface | When | Example |
|---|---|---|
| `PropertyDetail` panel | Always — primary explanation surface | `<MarketContext>` (Vision #7), `<ResearchPanel>` |
| `PropertyCard` chip | Cheap signals that fit on a card | "vs county median $/acre" |
| `FilterPanel` filter | When users will want to filter on this dimension | Min homestead-fit score, AI tags |
| Composite into `dealScore` | When the signal genuinely affects deal quality | Improvement tier residual $/acre |

For the panel, follow `MarketContext.tsx` as the model:

- Self-gate on data depth (don't render if signal is missing or
  thin enough to mislead)
- Lead with the headline number, then explain
- Cite the data source in a small footer line — "via FEMA / FCC / etc."

### 4. Tests

- Vitest for any non-trivial calc (`marketStats.test.ts` is the
  reference). Test against `Property` stub fixtures, not against
  the real corpus.
- Pytest for the enrichment fixture round-trip — feed in a 2-row
  fixture, assert the field gets stamped.

### 5. Ship it

- `npm run type-check && npm run lint && npx vitest run`
- `cd scraper && python -m pytest tests/test_<feature>.py -v`
- Run the enrichment locally against `data/listings.json` to verify
  it works on real data
- Commit with `feat: <feature> enrichment + UI`

---

## Recent examples

| Item | Field | Scraper module | UI |
|---|---|---|---|
| #5 Draw-boundary search | `FilterState.drawnArea` | n/a (interactive) | `MapView` overlay + `useProperties` filter |
| #7 Property-as-stock analytics | derived from corpus | n/a (in-memory) | `MarketContext.tsx` panel + `PropertyCard` chip |
| Soil enrichment | `soil: SoilInfo` | `scraper/enrichment/soil.py` | `ResearchPanel` |
| AI fit + red flags | `homesteadFitScore`, `redFlags` | `scraper/enrich.py` | `FilterPanel` + `PropertyCard` + detail panel |

---

## When to bundle vs. independent

Several vision items answer the same higher-order question:

- **#11 voting patterns** → "would I fit in here politically?"
- **#10 demographics** → "who are my neighbors?"
- **#6 climate risk** → "is the place habitable in 20 years?"
- **#8 emergency services** → "can I get help fast?"
- **#9 FCC broadband** → "can I work remotely from here?"

All of these answer **"what's it actually like to live here?"** They
should ship as ONE composite — `LifestyleFit` — with one panel, one
filter, and a single composite score. Five separate panels would
clutter PropertyDetail and confuse users.

When deciding bundle vs. independent, ask: *do these signals
naturally appear together in a buyer's decision?* If yes, bundle.

---

## Anti-patterns (don't do this)

- **Don't add a new top-level `Property` field for every signal.**
  Group related signals into a typed sub-object (like `SoilInfo`,
  `FloodInfo`). It keeps the type readable and migration easy.
- **Don't synthesize signals client-side from raw data on every
  render.** If it's expensive, compute once in the scraper and
  stamp the result.
- **Don't ship a filter without a UI surface.** Users won't notice
  filterable signals that don't show on cards.
- **Don't forget `--skip-<feature>` gating in `main.py`.** A 3-minute
  enrichment that runs unconditionally during local iteration kills
  productivity.
- **Don't make the field required.** Older rows in the corpus
  won't have it. Optional + defensive UI rendering.
