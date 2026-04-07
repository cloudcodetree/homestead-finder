# Homestead Finder — Full Product Vision Design

**Status:** APPROVED
**Date:** 2026-04-07

---

## Decisions Made

- **Product type:** Niche SaaS with tiered pricing
- **Target users:** Both homesteaders (free tier) and tax sale investors (paid tier)
- **Value ladder:** Time savings (free) → Information edge (Pro) → Analysis & enrichment (Premium)
- **Auth approach:** Clerk (managed auth, free up to 10K MAU)
- **Timeline:** No rush — build it right, ship free tier first
- **Build priority:** A (Dashboard SaaS) → C (Data/API) → B (Alerts)
- **Mobile:** Future consideration — API-first design in Phase C makes PWA or React Native possible
- **Revenue streams:** Subscriptions + contextual ads/affiliates + API access + exports
- **Anti-scraping:** Cloudflare + API-gated data + rate limiting + auth for bulk access

---

## Section 1: Tier Structure

Three tiers with a clear value ladder. Free tier drives SEO traffic, Pro converts serious users, Premium serves investors.

| | **Free** | **Pro ($19/mo)** | **Premium ($39/mo)** |
|---|---|---|---|
| **Phase A: Dashboard** | | | |
| Browse listings (map + list) | All listings | All listings | All listings |
| Deal scores | Visible | Visible | Visible |
| Filters (state, price, features) | Full | Full | Full |
| Property detail page | Basic | Full + parcel history | Full + enriched |
| Tax sale calendar | View-only | With reminders | With reminders |
| Data window | Last 7 days | Full history | Full history |
| **Phase C: Data** | | | |
| CSV export | -- | 100 rows/export | Unlimited |
| API access | -- | -- | Full REST API |
| Enriched fields (soil, flood, distance) | -- | -- | All fields |
| Comparable sales | -- | -- | Last 2 years |
| **Phase B: Alerts** | | | |
| Email alerts | -- | 3 saved searches | Unlimited |
| SMS alerts | -- | -- | Included |
| Weekly digest | -- | Included | Included |
| Auction countdown reminders | -- | -- | Included |

**Paywall boundary:** Users see all listings, all scores, all filters for free. The gate is on **history** (7-day window), **export**, **alerts**, and **enrichment**. This preserves SEO value (Google indexes current listings) while creating clear reasons to upgrade.

---

## Section 2: Technical Architecture

### Current State (Phase 0)
```
GitHub Actions (cron) → Python Scraper → data/listings.json → git push
GitHub Pages → React/Vite SPA → fetch(listings.json) → Dashboard
```

### Phase A: Dashboard SaaS
```
GitHub Actions (cron) → Python Scraper → Turso (SQLite DB)
Vercel → Next.js (App Router) → /api/* routes → Turso → Dashboard
Clerk → Auth (sign-up, login, sessions)
Stripe → Subscription billing ($19/$39 tiers)
Cloudflare → Bot protection (free tier)
```

| Service | Role | Cost |
|---------|------|------|
| **Next.js** on Vercel | Frontend + API routes (replaces Vite + GitHub Pages) | $0 (free tier) |
| **Turso** | SQLite database (replaces JSON-in-git) | $0 (free: 9GB, 25M reads/mo) |
| **Clerk** | Auth — sign-up, login, sessions | $0 (free: 10K MAU) |
| **Stripe** | Subscription billing | 2.9% + $0.30/transaction |
| **Cloudflare** | Bot protection, CDN | $0 (free tier) |
| **GitHub Actions** | Scraper (unchanged) | $0 (free: 2,000 min/mo) |

### Phase C: Data & API Additions
- REST API via Vercel Functions — mobile-ready by design
- Enrichment pipeline (Nominatim geocoding, USDA soil, FEMA flood zones)
- CSV/JSON export endpoints
- Historical price tracking in Turso
- API key management for Premium tier

### Phase B: Alert Additions
- SendGrid (email) + Twilio (SMS, optional)
- Notification engine runs post-scrape, matches new listings against saved searches
- Auction calendar with countdown reminders

### Mobile Path
Phase C's API routes serve both the web dashboard and a future mobile client. Three options available when ready:
1. **PWA** — zero extra code, 80% of native feel
2. **React Native** — shares TypeScript types and business logic
3. **Any framework** — API-first means any client can consume it

---

## Section 3: Pages & User Flows

### Public Pages (SEO + free tier, no login required)

| Route | Purpose | SEO target |
|-------|---------|------------|
| `/` | Landing page — hero, live stats, CTA | "homestead land deals" |
| `/deals` | Main dashboard — map + list + filters | "cheap land for sale" |
| `/deals/[id]` | Individual listing detail | "40 acres Montana tax sale $2,000" (long-tail) |
| `/states/[state]` | State landing page — stats, top deals, calendar | "[state] tax sale land" |
| `/calendar` | Tax sale calendar — upcoming auctions by state | "tax sale auction dates [state]" |
| `/learn` | Guides — "What is a tax deed?" (future) | Content marketing for trust + SEO |

Each `/deals/[id]` page is server-rendered for Google indexing. With 5,000+ listings, that's 5,000+ indexed long-tail pages.

### Authenticated Pages (Pro + Premium, login required)

| Route | Purpose | Tier |
|-------|---------|------|
| `/dashboard` | Personal home — saved searches, watchlist, recent alerts | Free (after sign-up) |
| `/searches` | Saved search management — create, edit, delete | Pro (3) / Premium (unlimited) |
| `/watchlist` | Tracked parcels — price changes, status updates, countdowns | Pro |
| `/settings` | Account, notification preferences, billing (Stripe portal) | All authenticated |
| `/export` | CSV/JSON download of filtered listings | Pro (100 rows) / Premium (unlimited) |
| `/api` | API docs, key management, usage stats | Premium |

### Conversion Funnel

```
Google "montana tax sale land"
  → /states/MT (SEO landing page)
  → /deals (browse, filter, find interesting listings)
  → /deals/[id] (view detail, see score)
  → "Save this search" or "Get alerts" → sign-up wall
  → Clerk sign-up (free account)
  → Free user browses for days/weeks (7-day data window)
  → "View older listings" or "Export" → paywall
  → Stripe checkout → Pro ($19/mo)
  → Power user wants enriched data, API, comps
  → Upgrade → Premium ($39/mo)
```

### Ad Placements (designed in, filled later)

On listing detail pages (`/deals/[id]`) and state pages (`/states/[state]`):
- **"Local Agents" sidebar** — affiliate links to land-specialized brokerages
- **AdSense fallback** — for counties without affiliate partnerships
- **"Related Services" section** — title companies, surveyors, soil testing

Implementation: placeholder `<div>` slots in page components. Zero code complexity until monetized.

---

## Section 4: Data Model

### listings
```sql
CREATE TABLE listings (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  price           REAL NOT NULL,
  acreage         REAL,              -- nullable for tax sales
  price_per_acre  REAL,
  state           TEXT NOT NULL,
  county          TEXT NOT NULL,
  lat             REAL,
  lng             REAL,
  features        TEXT,              -- JSON array
  source          TEXT NOT NULL,
  url             TEXT NOT NULL,
  description     TEXT,
  deal_score      INTEGER NOT NULL DEFAULT 0,
  sale_type       TEXT,              -- tax_lien, tax_deed, tax_forfeiture, etc.
  parcel_number   TEXT,
  status          TEXT DEFAULT 'active',  -- active, sold, expired
  first_seen      TEXT NOT NULL,     -- ISO date
  last_seen       TEXT NOT NULL,     -- ISO date
  enriched_at     TEXT,              -- Phase C
  soil_type       TEXT,              -- Phase C
  flood_zone      TEXT,              -- Phase C
  nearest_town    TEXT,              -- Phase C
  nearest_town_mi REAL              -- Phase C
);
```

### users
```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,     -- Clerk user ID
  email      TEXT NOT NULL,
  tier       TEXT DEFAULT 'free',  -- free, pro, premium
  stripe_id  TEXT,
  created_at TEXT NOT NULL,
  api_key    TEXT                   -- Phase C
);
```

### saved_searches
```sql
CREATE TABLE saved_searches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  filters        TEXT NOT NULL,     -- JSON matching FilterState type
  alerts_enabled INTEGER DEFAULT 0,
  last_notified  TEXT,
  created_at     TEXT NOT NULL
);
```

### watchlist
```sql
CREATE TABLE watchlist (
  user_id    TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  added_at   TEXT NOT NULL,
  notes      TEXT,
  PRIMARY KEY (user_id, listing_id)
);
```

### price_history (Phase C)
```sql
CREATE TABLE price_history (
  listing_id  TEXT NOT NULL REFERENCES listings(id),
  price       REAL NOT NULL,
  recorded_at TEXT NOT NULL
);
```

### auction_events
```sql
CREATE TABLE auction_events (
  id                    TEXT PRIMARY KEY,
  state                 TEXT NOT NULL,
  county                TEXT NOT NULL,
  platform              TEXT,
  sale_type             TEXT,
  auction_date          TEXT NOT NULL,
  registration_deadline TEXT,
  url                   TEXT,
  listing_count         INTEGER,
  source_registry_id    TEXT
);
```

### Key Design Choices
- **Enrichment fields are nullable columns** on listings, not a separate table — simpler queries, and most listings will eventually be enriched
- **Clerk manages auth**; we mirror `user_id` and `tier` locally for fast queries without hitting the Clerk API
- **`saved_searches.filters` is JSON** matching the frontend `FilterState` type, so the scraper can match new listings against saved searches directly
- **`listings` tracks lifecycle** via `first_seen`, `last_seen`, and `status` — enables "this listing has been available for 45 days" and detecting when things sell
- **`price_history`** enables "price dropped!" alerts in Phase C

---

## Section 5: Revenue & Monetization

### Revenue Streams

| Stream | Phase | Model | Notes |
|--------|-------|-------|-------|
| **Pro subscriptions** | A | $19/mo, ~5% conversion | Saved searches, full history, export |
| **Premium subscriptions** | A | $39/mo, ~1% conversion | API, enrichment, comps, unlimited alerts |
| **Affiliate/ads** | A | Per-referral or CPM | Land brokerages, title companies, surveyors |
| **API access** | C | Bundled in Premium | Could be standalone for developers later |
| **Data exports** | C | Bundled in Pro/Premium | Could be per-export for free users later |

### Revenue Projections

| Scale | Subscriptions | Ads/Affiliates | Total Revenue | Total Costs | Margin |
|-------|--------------|----------------|---------------|-------------|--------|
| 1K users | $1,340/mo (50 Pro + 10 Premium) | $50-200/mo | ~$1,500/mo | ~$50/mo | ~96% |
| 10K users | $13,400/mo (500 Pro + 100 Premium) | $500-2,000/mo | ~$15,000/mo | ~$520/mo | ~96% |

### Cost Breakdown at 10K Users

| Service | Monthly cost |
|---------|-------------|
| Vercel Pro | $20 |
| Turso | $30 |
| Clerk | $25 |
| Stripe fees (2.9%) | ~$400 |
| Scraping (Claude + Firecrawl) | $10-20 |
| SendGrid | $15 |
| **Total** | **~$520** |

### Ad Monetization Strategy

Phased approach, lowest effort first:
1. **Affiliate links** (Phase A launch) — partner with United Country, Mossy Oak Properties, Whitetail Properties. Pay per referred closing ($50-500). Zero effort once set up.
2. **AdSense** (at 10K+ monthly visitors) — contextual ads on listing and state pages. ~$1-3 CPM.
3. **Direct partnerships** (at 50K+ monthly visitors) — "Featured Agent in [County]" sponsorship spots. $50-200/month per county.

---

## Section 6: Security & Anti-Scraping

### Phase A (built into Next.js from day one)

| Layer | Implementation | What it stops |
|-------|---------------|---------------|
| **Cloudflare** | Free tier in front of Vercel | Most automated scrapers |
| **API-gated data** | Listings loaded via `/api/listings`, not static JSON | View-source extraction |
| **Pagination** | Unauthenticated: max 20 results per call, 7-day window only | Bulk data extraction |
| **robots.txt** | Allow `/deals/*`, `/states/*`; disallow `/api/*`, `/export/*` | Polite bots |
| **Vercel BotID** | Built-in bot detection | Headless browsers |

### Phase C (when API tier launches)

| Layer | Implementation | What it stops |
|-------|---------------|---------------|
| **API keys** | Premium users get keys, 1,000 calls/day limit | Unauthorized API use |
| **Watermarking** | Subtle per-user markers in exported CSVs | Leaked data tracing |
| **Rate limiting** | Upstash Redis (free tier) per-IP and per-key | Abuse |

### Policy (ongoing)

- **Terms of Service** — prohibit redistribution and automated access without API key
- **Stale data defense** — scores and enrichment update daily; scraped copies decay within a week
- **Owner name redaction** — stored in raw data for research, not displayed on frontend
- **Respond to C&D** — if any party asks us to stop, we stop immediately for that source

---

## Section 7: Migration Plan

### Overview

Four independent workstreams to get from Phase 0 (current) to Phase A (product):

```
  Week 1          Week 2          Week 3          Week 4          Week 5          Week 6
┌───────────────────────────────┐
│ 1. Next.js scaffold + port    │
│    components + routing       │
└───────────────────────────────┘
┌───────────────────┐
│ 2. Turso setup +  │
│    schema + seed  │
└───────────────────┘
                    ┌───────────────────┐
                    │ 3. Clerk auth +   │
                    │    Stripe billing │
                    └───────────────────┘
                                        ┌───────────────────────────────┐
                                        │ 4. SEO pages + landing +      │
                                        │    Vercel deploy + Cloudflare │
                                        └───────────────────────────────┘
                                                                        ┌───────────────┐
                                                                        │ 5. Polish +   │
                                                                        │    soft launch│
                                                                        └───────────────┘
```

### Workstream 1: Frontend (React/Vite → Next.js)

**What moves over unchanged:**
- All TypeScript types (`property.ts`, `FilterState`)
- All utility functions (`formatters.ts`, `scoring.ts`, `validation.ts`)
- Component logic (hooks, state management)

**What changes:**
- Routing: SPA → file-based (`app/deals/[id]/page.tsx`, `app/states/[state]/page.tsx`)
- Data fetching: client-side `fetch()` → server components + API routes
- Layout: add `<ClerkProvider>`, nav with sign-in/sign-up
- Build: Vite → Next.js bundler (Turbopack)
- CSS: Tailwind carries over, add Clerk component styles

**What gets dropped:**
- `vite.config.ts`
- `deploy-pages.yml` workflow
- `frontend/public/data/` (data comes from Turso now)

### Workstream 2: Database (JSON-in-git → Turso)

- Create Turso database and apply schema from Section 4
- Add `libsql` Python client to scraper `requirements.txt`
- Scraper `main.py`: replace `json.dumps()` → Turso `INSERT/UPDATE`
- Migrate existing `data/listings.json` as seed data
- Add Turso connection URL to GitHub Actions secrets
- Keep `data/source_registry/` as config files (not in DB)
- Keep `data/ai_costs.json` and `data/learned_selectors/` as files (scraper-internal state)

### Workstream 3: Auth & Payments

- Install Clerk Next.js SDK, add `<ClerkProvider>` to root layout
- Middleware: protect `/dashboard/*`, `/searches/*`, `/watchlist/*`, `/export/*`
- Public routes: `/`, `/deals`, `/deals/[id]`, `/states/[state]`, `/calendar`
- Add Stripe Checkout for Pro/Premium upgrades from `/settings`
- Stripe webhook: `checkout.session.completed` → update `users.tier` in Turso
- Sync Clerk user creation → insert into `users` table

### Workstream 4: Deployment

- Connect repo to Vercel (auto-deploys on push to main)
- Configure Vercel environment variables (Turso URL, Clerk keys, Stripe keys)
- Optional: Cloudflare DNS in front of Vercel domain
- Update `scrape.yml`: add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` secrets
- Remove `deploy-pages.yml` workflow
- Verify scraper writes to Turso successfully in CI

### What Stays the Same

- **Python scraper** — same code, same strategy chain, same AI pipeline. Only output target changes (Turso instead of JSON).
- **Scoring engine** — unchanged
- **Source registry** — unchanged (stays as JSON config files)
- **GitHub Actions cron** — same schedule, same runner, just writes to Turso
- **AI learning pipeline** — unchanged, still uses file-based `data/learned_selectors/`

---

## Appendix: File Structure (Phase A)

```
homestead-finder/
├── app/                          ← Next.js App Router (replaces frontend/src/)
│   ├── layout.tsx                ← Root layout + ClerkProvider
│   ├── page.tsx                  ← Landing page (/)
│   ├── deals/
│   │   ├── page.tsx              ← Dashboard (/deals)
│   │   └── [id]/
│   │       └── page.tsx          ← Listing detail (/deals/[id])
│   ├── states/
│   │   └── [state]/
│   │       └── page.tsx          ← State landing (/states/[state])
│   ├── calendar/
│   │   └── page.tsx              ← Tax sale calendar
│   ├── dashboard/
│   │   └── page.tsx              ← Personal dashboard (auth required)
│   ├── searches/
│   │   └── page.tsx              ← Saved searches (auth required)
│   ├── watchlist/
│   │   └── page.tsx              ← Watchlist (auth required)
│   ├── settings/
│   │   └── page.tsx              ← Account + billing (auth required)
│   ├── export/
│   │   └── page.tsx              ← Data export (Pro+)
│   └── api/
│       ├── listings/
│       │   ├── route.ts          ← GET /api/listings (paginated)
│       │   └── [id]/
│       │       └── route.ts      ← GET /api/listings/[id]
│       ├── searches/
│       │   └── route.ts          ← CRUD /api/searches
│       ├── watchlist/
│       │   └── route.ts          ← CRUD /api/watchlist
│       ├── export/
│       │   └── route.ts          ← GET /api/export (CSV/JSON)
│       └── webhooks/
│           └── stripe/
│               └── route.ts      ← Stripe webhook handler
├── components/                    ← Shared React components (ported from frontend/src/)
├── lib/                           ← Utilities, DB client, auth helpers
├── scraper/                       ← Python scraper (unchanged)
├── data/
│   ├── source_registry/           ← Source catalog (JSON config)
│   ├── learned_selectors/         ← AI-cached selectors
│   └── ai_costs.json             ← API spend log
├── docs/                          ← Planning documents
└── context/                       ← Session continuity
```
