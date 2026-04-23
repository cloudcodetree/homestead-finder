# Source Discovery — Runbook & Methodology

This document explains (a) how we find new land-listing sources and
(b) the pipeline that automates the first-pass filtering. The goal
is to keep expanding coverage of **hidden-gem** inventory — FSBO
classifieds, niche brokerages, government surplus, and any channel
the big aggregators (LandWatch / Land.com family) don't index.

---

## When to run

- **Weekly** — automated via `.github/workflows/discover.yml` (opens
  a GitHub issue with the top-20 candidates). Review the issue,
  approve or reject each candidate.
- **Ad hoc** — when pivoting to a new state or noticing a new channel
  shape (e.g. "estate sales" as a category), run `python -m discovery.run`
  locally to get a fresh list.

---

## The pipeline

```
seeds.yml         discover.py         probe.py           rank.py         scaffold.py
  │                   │                  │                  │                 │
  │ templated         │ DDG HTML         │ HTTP fetch       │ inventory ×     │ codegen'd
  │ queries per       │ search,          │ homepage +       │ accessibility   │ starter
  │ state/region      │ dedupe by        │ sitemap.xml,     │ − walls =       │ source
  │                   │ domain,          │ detect render    │ score           │ module
  │                   │ apply blocklist  │ type + walls     │                 │
  ▼                   ▼                  ▼                  ▼                 ▼
 ~50 queries     ~200 candidates    ~60 probed       ranked list      stub .py file
```

1. **seeds.yml** — hand-curated search templates in four buckets:
   - `fsbo_queries` — FSBO / owner-finance channels
   - `local_queries` — hyper-local brokerages
   - `government_queries` — tax / sheriff / forfeiture / probate
   - `auction_queries` — online land auctions

2. **discover.py** — expands each template against every state/region
   and submits the rendered queries to DuckDuckGo's HTML endpoint
   (`html.duckduckgo.com/html/`). Collects unique domains, subtracts
   the `blocklist:` set. Throttled by the shared `throttle` module.

3. **probe.py** — for each candidate, fetches the homepage and
   `/sitemap.xml`, detecting:
   - **Render type**: next.js_ssr / server_rendered_cards /
     jsonld_places / react_spa / unknown
   - **Walls**: cloudflare / captcha / login_wall
   - **Inventory signal**: sitemap URLs matching land/listing paths,
     filtered by MO/AR slugs when possible

4. **rank.py** — `score = inventory × accessibility × wall_factor`.
   Accessibility weights: next.js SSR (1.0) > server-rendered (0.85)
   > JSON-LD (0.75) > SPA (0.25). Login/captcha walls zero the score.

5. **scaffold.py** — for approved candidates, generate a starter
   source module with the right render-type boilerplate pre-filled.

---

## Heuristics learned (2026-04-22/23 session)

Document findings here whenever a new probe teaches us something
transferable. Keeps the `rank.py` weights honest.

### Render-type → access cost

| Render | Observed cost | Notes |
|---|---|---|
| `next.js_ssr` | 1 HTTP call, JSON parse | LandHub, Mossy Oak variants |
| `server_rendered_cards` | 1 HTTP call, BS4 scrape | UCRE state pages, Mossy Oak |
| `jsonld_places` | 1 HTTP call, JSON parse | Some Homes.com pages |
| `react_spa` | Playwright required | FSBO.com, Land.com family |

### Walls we can still crack

- **Cloudflare-only (TLS fingerprint)** → `curl_cffi` impersonation
  passes in ~0.8s. LandWatch, Lands of America, Bid4Assets.
- **Cloudflare + JS challenge** → needs Playwright with stealth
  patches. UCRE, some tax-sale sites.
- **Login wall + captcha** → hard block. Facebook Marketplace, PACER.
  Do not attempt.

### Inventory density we've seen

| Source | MO+AR listings | Worth scraping? |
|---|---|---|
| LandWatch | ~2000+ | Yes — baseline |
| LandHub | ~2350 | Yes (just shipped) |
| UCRE | ~800 | Yes |
| Mossy Oak | ~50 | Yes — quality over quantity |
| Craigslist | ~5-15/day | Yes — FSBO goldmine |
| FSBO.com | ~6 total | No |
| US Marshals | ~0-1/yr | No |

### Rejection criteria (blocklist on sight)

A candidate goes to `seeds.yml:blocklist` without probing if:
- It's a social network or login-walled platform.
- It's a known Land.com / LandWatch family redirect (net zero new
  inventory).
- It's a listicle / SEO farm with no actual listings (Wikipedia,
  Medium, Reddit, Quora).
- It's a news site covering land sales (not the sales themselves).

### When probe misses a real signal

- Sites that hide listings behind a ZIP search with no crawlable
  index page score 0 on inventory but may still be valuable. Look
  for these manually.
- Sites whose sitemap lives somewhere non-standard (`/listings.xml`,
  `/sitemap_index.xml`) won't get picked up — the candidate will
  still be reviewed based on render_type alone.

---

## Throttle & politeness

All discovery fetches route through `scraper/throttle.py`, which:
- Enforces per-domain crawl delay (honors `robots.txt Crawl-delay:`)
- Backs off exponentially on 429/503 (5s → 30s → 120s)
- Caps requests-per-domain-per-day at 500 (env: `THROTTLE_MAX_PER_DAY`)
- Refuses to fetch paths disallowed by robots.txt
- Persists daily counters to `data/scrape_quota.json`

Never bypass the throttle layer in a new scraper. If a site needs a
lower crawl delay, set `RATE_LIMIT_SECONDS` on the scraper class;
the throttle layer takes the stricter of the two.

---

## Adding a candidate manually

```bash
cd scraper
python -m discovery.scaffold myfarm-broker.com --render next.js_ssr
# → creates scraper/sources/myfarm_broker.py with the boilerplate
```

Then:

1. Edit the new file — search `TODO` to see what needs filling in.
2. Register in `scraper/main.py` `ALL_SCRAPERS`.
3. Enable in `scraper/config.py` `ENABLED_SOURCES`.
4. Add strategy chain to `scraper/config.py` `STRATEGY_CHAINS`.
5. Add display name in `frontend/src/utils/formatters.ts`
   `formatSourceName`.
6. Test: `python main.py --dry-run --source=myfarm_broker --states=MO`
7. Commit with message `feat(scraper): {domain} (+N rows)`.
