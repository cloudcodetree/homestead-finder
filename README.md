# 🌿 Homestead Finder

A tool that periodically scrapes land and property listings nationwide, scores them as homesteading deals, and displays them on an interactive dashboard with email notifications for hot deals.

**Live dashboard:** https://cloudcodetree.github.io/homestead-finder/

---

## Features

- **Multi-source scraping** — LandWatch, Lands of America, county tax sales, BLM, auction sites
- **Deal scoring** — 0–100 score based on price vs. regional median, features, days on market
- **Interactive dashboard** — Map view + list view with collapsible filters (price, acreage, state, features)
- **Sort listings** — By deal score, price, price/acre, acreage, or recency
- **Validation status** — Each listing shows a Verified / Unverified / Expired badge; URL is displayed with a copy button
- **Mobile-friendly** — Filter drawer slides in from the left; floating "Filters (N)" button shows active filter count
- **Email alerts** — Notified via SendGrid when new deals score ≥ 75
- **Automated** — GitHub Actions runs the scraper daily at 6am UTC

## Architecture

```
Python Scraper (GitHub Action) ──► data/listings.json ──► React Dashboard (GitHub Pages)
         │                                                         │
         ▼                                                         ▼
   SendGrid Email                                          Leaflet Map + Filters
```

## Getting Started

### Prerequisites
- Node 20+
- Python 3.12+
- Git

### Frontend (Dashboard)

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Scraper

```bash
cd scraper
pip install -r requirements.txt

# Test without writing files:
python main.py --dry-run

# Run specific source:
python main.py --source=landwatch --states=MT,ID

# Full run:
python main.py
```

### Environment Variables (for notifications)

```bash
export SENDGRID_API_KEY=your_key_here
export NOTIFICATION_EMAIL=you@example.com
```

Or add as GitHub repository secrets.

## Data Sources

| Source | Type | Notes |
|--------|------|-------|
| LandWatch | Land listings | Largest land marketplace |
| Lands of America | Land listings | Broad coverage |
| County Tax Sales | Tax deed/lien | Most motivated sellers |
| BLM/USDA | Government land | Low price, remote |
| Auction (Hubzu) | Foreclosure | Bank-owned properties |
| Zillow | Land/lots | Disabled by default (rate limits) |
| Realtor.com | Land | Disabled by default (rate limits) |

## Deal Scoring

Scores range 0–100:

| Factor | Weight | Details |
|--------|--------|---------|
| Price vs. median | 40% | Price/acre vs. USDA regional median |
| Features | 30% | Water, road, electric, zoning, etc. |
| Days on market | 20% | Longer = more negotiating leverage |
| Source reliability | 10% | County tax sales score highest |

Scores ≥ 75 = email notification.

## Adding a New Data Source

See `.claude/skills/scraper-dev/SKILL.md` for the full pattern, or use the slash command:

```
/add-source [name] [url]
```

## Deployment

- **Dashboard** deploys automatically to GitHub Pages on push to `main`
- **Scraper** runs daily at 6am UTC via GitHub Actions
- Set `SENDGRID_API_KEY` and `NOTIFICATION_EMAIL` as repo secrets for notifications

## Development with Claude Code

This project is configured for Claude Code with:
- `.claude/CLAUDE.md` — Project rules and session protocols
- `.claude/skills/` — Specialized skills for scraper, frontend, and deal analysis
- `.claude/agents/` — Pre-configured agent personas
- `.claude/commands/` — Slash commands (`/add-source`, `/run-scraper`, `/analyze-deals`)
- `context/` — Rolling context for session continuity across machines

Start a session by reading `context/ROLLING_CONTEXT.md` for current project state.

## License

MIT
