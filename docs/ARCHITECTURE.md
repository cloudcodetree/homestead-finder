# Homestead Finder — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GitHub Actions (Daily Cron)                      │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │   Scraper    │───▶│  Scoring     │───▶│  data/listings.json    │  │
│  │   Sources    │    │  Engine      │    │  (committed to git)    │  │
│  └──────┬──────┘    └──────────────┘    └──────────┬─────────────┘  │
│         │                                          │                │
│         ▼                                          ▼                │
│  ┌─────────────┐                          ┌──────────────────┐     │
│  │  Strategy    │                          │  SendGrid Email  │     │
│  │  Chain       │                          │  (score >= 75)   │     │
│  └──────┬──────┘                          └──────────────────┘     │
│         │                                                          │
│    ┌────┼────┬──────────┐                                          │
│    ▼    ▼    ▼          ▼                                          │
│  HTTP  Browser Firecrawl Claude                                    │
│  (free) (free)  (paid)  (paid)                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ git push
┌─────────────────────────────────────────────────────────────────────┐
│                     GitHub Pages (Static Frontend)                   │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  React + TypeScript + Vite                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ Dashboard │ │ Map View │ │ Filters  │ │ Property Detail  │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│         ▲                                                           │
│         │ fetch('./data/listings.json')                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Scraper Architecture

### Strategy Chain (per-source fallback)

Each scraper source has an ordered list of fetch strategies. If one fails, the next is tried automatically.

```
Source: LandWatch          Source: GovEase           Source: BLM
Chain:                     Chain:                    Chain:
  1. HTTP (403'd)            1. HTTP ✓                 1. HTTP (404)
  2. Playwright (403'd)      (no fallback needed)      2. Firecrawl
  3. Firecrawl (paid)
  4. Claude (paid)
```

Strategy implementations:

| Strategy | File | Cost | Cloudflare bypass |
|----------|------|------|-------------------|
| `SimpleHTTPStrategy` | `strategies/http.py` | Free | No |
| `BrowserStrategy` | `strategies/browser_strategy.py` | Free | Sometimes |
| `FirecrawlStrategy` | `strategies/firecrawl_strategy.py` | ~$0.001/page | Yes |
| `ClaudeExtractionStrategy` | `strategies/claude_strategy.py` | ~$0.01/page | N/A (parse only) |
| `SeleniumStrategy` | `strategies/selenium_strategy.py` | Free | Sometimes |

### AI Learning Pipeline

When hardcoded CSS selectors break (site changes HTML), the AI learns new ones:

```
Parse returns 0 results?
  │
  ├── Try learned selectors (data/learned_selectors/<source>.json)
  │     └── Free — cached from prior AI run
  │
  ├── AI selector discovery (Claude Sonnet)
  │     ├── Analyzes HTML structure
  │     ├── Returns new CSS selectors
  │     └── Saves for next run (free on subsequent runs)
  │
  └── Direct AI extraction (Claude Haiku)
        └── Extracts listings from raw content (last resort)
```

Model escalation: Haiku ($0.80/MTok) → Sonnet ($3/MTok) → Opus ($15/MTok)

### Data Flow

```
1. main.py runs (via cron or manual)
2. For each enabled source:
   a. Scraper.fetch(state) → raw items via strategy chain
   b. Scraper.parse(item) → RawListing dataclass
   c. Scraper.normalize(raw) → Property dict (standard schema)
   d. If parse returns 0 → AI fallback pipeline
3. Deduplicate by URL
4. ScoringEngine.score_all() → adds dealScore (0-100)
5. Sort by score descending
6. Write data/listings.json
7. Filter hot deals (score >= 75, not previously notified)
8. Send email via SendGrid
9. git commit + push (in GitHub Actions)
```

## Frontend Architecture

```
frontend/src/
├── App.tsx                  ← Renders Dashboard
├── main.tsx                 ← Vite entry point
├── index.css                ← Tailwind imports
├── components/
│   ├── Dashboard.tsx        ← Layout: header + sidebar + main
│   ├── FilterPanel.tsx      ← Left sidebar with all filters
│   ├── MapView.tsx          ← Leaflet map (lazy loaded)
│   ├── PropertyCard.tsx     ← Listing card with parcel/sale type
│   ├── PropertyDetail.tsx   ← Modal with full details
│   └── NotificationSettings.tsx
├── hooks/
│   ├── useProperties.ts     ← Fetch + filter + sort listings
│   └── useFilters.ts        ← Filter state management
├── types/
│   └── property.ts          ← Property, FilterState, feature enums
└── utils/
    ├── formatters.ts        ← Currency, acreage, date formatting
    └── scoring.ts           ← Score color/label helpers
```

Data loading: `useProperties` fetches `./data/listings.json` (falls back to sample data for dev).

## File System Layout

```
homestead-finder/
├── .claude/                 ← Claude Code config (skills, agents, commands)
├── .github/workflows/       ← CI/CD (scrape.yml, deploy-pages.yml, test.yml)
├── context/                 ← Session continuity (ROLLING_CONTEXT, DECISIONS, BACKLOG)
├── data/
│   ├── listings.json        ← Current scraped + scored listings
│   ├── notified.json        ← IDs of listings we've emailed about
│   ├── ai_costs.json        ← API spend tracking
│   ├── learned_selectors/   ← AI-discovered CSS selectors (cached)
│   └── source_registry/     ← Catalogued government property sources
│       ├── registry.json    ← Master index (platforms + state portals)
│       └── states/*.json    ← Per-state source catalog
├── docs/                    ← Planning documents (this directory)
├── frontend/                ← React + Vite dashboard
└── scraper/
    ├── main.py              ← Orchestrator + CLI
    ├── config.py            ← All configuration (env vars)
    ├── scoring.py           ← Deal scoring engine
    ├── logger.py            ← Structured logging setup
    ├── notifier.py          ← SendGrid email alerts
    ├── sources/             ← Scraper implementations
    │   ├── base.py          ← BaseScraper ABC + AI fallback
    │   ├── govease.py       ← GovEase tax sales (working)
    │   ├── landwatch.py     ← LandWatch (blocked by Cloudflare)
    │   └── ...              ← 6 more source scrapers
    ├── strategies/          ← Fetch strategy chain
    │   ├── base.py          ← FetchStrategy ABC + FetchStrategyChain
    │   ├── http.py          ← Tier 1: requests
    │   ├── browser_strategy.py  ← Tier 2: Playwright
    │   ├── firecrawl_strategy.py ← Tier 3: Firecrawl API
    │   ├── claude_strategy.py    ← Tier 4: Claude extraction
    │   └── cost_tracker.py  ← API spend tracking
    ├── ai/                  ← AI learning pipeline
    │   ├── learning.py      ← Main pipeline orchestrator
    │   ├── models.py        ← Model escalation (Haiku→Sonnet→Opus)
    │   ├── selectors.py     ← Learned selector management
    │   ├── prompts.py       ← AI prompt templates
    │   └── config.py        ← Model tiers + task mapping
    └── tests/               ← pytest tests (38 passing)
```

## State Persistence

All persistent state lives in `data/` and survives across GitHub Actions runs via git commit:

| File | What | Written by | Read by |
|------|------|-----------|---------|
| `listings.json` | Current listings | Scraper | Frontend |
| `notified.json` | Emailed listing IDs | Notifier | Notifier |
| `ai_costs.json` | API spend log | Cost tracker | Cost tracker, humans |
| `learned_selectors/*.json` | Cached CSS selectors | AI pipeline | AI pipeline |
| `source_registry/**` | Source catalog | Humans/Claude | Scraper, humans |
| `scraper.log` | Debug log | Logger | Humans (gitignored) |

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + TypeScript (strict) + Vite 5 | Modern, fast, type-safe |
| Styling | Tailwind CSS v3 | Utility-first, no switching files |
| Maps | Leaflet + react-leaflet | Free, open-source, good enough |
| Scraping | Python 3.12 + requests + BeautifulSoup + Playwright | Each tool has a role in the strategy chain |
| AI Fallback | Anthropic Claude API (Haiku/Sonnet/Opus) | Structured extraction, selector discovery |
| Cloudflare Bypass | Firecrawl (optional, paid) | Clean markdown from protected sites |
| Notifications | SendGrid free tier | 100 emails/day, simple API |
| CI/CD | GitHub Actions | Free tier, 2,000 min/month |
| Hosting | GitHub Pages | Free static hosting |
| Data | JSON files in git | Zero cost, version history, simple |
