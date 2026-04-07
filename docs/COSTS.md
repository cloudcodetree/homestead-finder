# Homestead Finder — Cost Analysis

## Current Cost: $0/month

Everything runs on free tiers:
- GitHub Actions: ~150 min/month of 2,000 free
- GitHub Pages: free static hosting
- No API keys configured yet

## Projected Costs by Tier

### Tier 0: Now (up to ~500 listings)

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| GitHub Actions | $0 | ~5 min/day scraping = ~150 min/month |
| GitHub Pages | $0 | Static frontend |
| Claude API (Haiku) | $1-3 | Only when AI fallback needed. Cached selectors = $0 on repeat runs |
| Firecrawl | $0-1 | Free tier: 500 credits/month |
| SendGrid | $0 | Free tier: 100 emails/day |
| **Total** | **$0-4** | |

### Tier 1: Growth (up to ~5,000 listings)

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Turso (SQLite) | $0 | Free tier: 9GB, 25M reads/month |
| Vercel | $0 | Free tier for frontend |
| GitHub Actions | $0 | Still within free tier |
| Firecrawl Hobby | $19 | 3,000 credits/month |
| Claude API | $3-5 | More sources, occasional rediscovery |
| **Total** | **$22-24** | |

### Tier 2: Production (up to ~50,000 listings)

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Turso Pro | $30 | 8GB, more compute |
| Vercel Pro | $20 | Analytics, faster builds |
| Railway (scraper) | $5-10 | Parallel scraping, always-on |
| Firecrawl Standard | $49 | 10,000 credits/month |
| Claude API | $10-20 | Batch API for 50% discount |
| **Total** | **$114-129** | |

## Cost Controls (Built In)

### Hard Caps
- `AI_MAX_SPEND_PER_RUN = $1.00` — enforced in `strategies/cost_tracker.py`
- `DAILY_CLAUDE_BUDGET_USD = $1.00` — daily ceiling
- `DAILY_FIRECRAWL_LIMIT = 50` — max Firecrawl calls per day

### Smart Defaults
- **Free strategies first** — HTTP and Playwright always tried before paid APIs
- **Cached selectors** — AI pays once to learn CSS selectors, free on all subsequent runs
- **Haiku by default** — $0.80/MTok input, 5-18x cheaper than Sonnet/Opus
- **Model escalation** — only uses expensive models when cheap ones fail
- **HTML preprocessing** — strips `<script>/<style>/<svg>` before sending to Claude, reducing tokens 60-80%

### Cost Tracking
All API spending is logged to `data/ai_costs.json`:
```json
{
  "total_spent_usd": 0.45,
  "days": {
    "2026-04-05": {
      "total_cost_usd": 0.09,
      "calls": [...]
    }
  },
  "model_stats": {
    "haiku": {"calls": 45, "successes": 42, "total_cost": 0.52},
    "sonnet": {"calls": 8, "successes": 7, "total_cost": 1.20}
  }
}
```

CLI command to see costs: `python main.py --validate-selectors` (prints cost summary).

### Estimated Per-Scenario Costs

| Scenario | Cost |
|----------|------|
| Typical daily run (selectors cached) | $0.00 |
| 1 source needs selector rediscovery (Sonnet) | ~$0.09 |
| 3 sources need AI extraction (Haiku) | ~$0.03 |
| Worst case: all sources need Opus | ~$3.00 |
| Monthly steady-state (selectors stable) | ~$1-3 |

## When to Upgrade

| Trigger | Action |
|---------|--------|
| `data/listings.json` > 5MB | Consider Turso for database |
| Need Cloudflare bypass daily | Add Firecrawl API key |
| Selectors breaking weekly | Review if sites are worth scraping vs. finding APIs |
| Users want real-time updates | Move scraper to always-on server |
| Monthly cost > $50 | Audit `ai_costs.json` and `data/scraper.log` for waste |

## ROI Principles

1. **Every dollar should produce data** — if an API call doesn't result in listings, investigate why
2. **Cache everything** — learned selectors, HTTP responses (304 Not Modified), scored listings
3. **Free sources first** — government sites have no Cloudflare and the best deals
4. **Don't scrape what hasn't changed** — check Last-Modified headers, skip if unchanged
5. **Batch when possible** — Claude Batch API is 50% cheaper for non-urgent tasks
