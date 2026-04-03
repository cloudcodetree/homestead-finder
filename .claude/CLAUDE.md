# Homestead Finder — Claude Code Project Rules

## Session Start Protocol
**ALWAYS do this at the start of every session:**
1. Read `context/ROLLING_CONTEXT.md` to understand current project state
2. Check `context/BACKLOG.md` for current priorities
3. Reference `context/DECISIONS.md` for architectural questions before proposing changes
4. Briefly confirm to the user what you understand the current state to be

## Session End Protocol
**ALWAYS do this before ending a session:**
1. Update `context/ROLLING_CONTEXT.md` with what was done, decisions made, and open questions
2. Add any new ADRs to `context/DECISIONS.md` if major technical decisions were made
3. Update `context/BACKLOG.md` if new tasks were identified or completed
4. Summarize the session for the user

---

## Project Overview

**Homestead Finder** is a tool that periodically scrapes land and property listings nationwide, scores them as homesteading deals, and presents them on a dashboard with notifications.

### Architecture
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Python Scraper │────▶│  JSON Data Files  │────▶│ React Dashboard │
│  (GitHub Action)│     │  (data/ folder)   │     │ (GitHub Pages)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                                                  │
         ▼                                                  ▼
  ┌─────────────┐                                  ┌──────────────┐
  │  SendGrid   │                                  │  Leaflet Map │
  │  (Notifier) │                                  │  + Filters   │
  └─────────────┘                                  └──────────────┘
```

### Data Flow
1. GitHub Actions triggers `scraper/main.py` daily at 6am UTC
2. Scraper fetches listings from multiple sources, normalizes them
3. Scoring engine calculates `dealScore` (0–100) for each listing
4. Results written to `data/listings.json` and `data/listings_YYYYMMDD.json`
5. Commit triggers `deploy-pages.yml` which builds and deploys the React frontend
6. Frontend reads `data/listings.json` from the repo root (served as static asset)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (strict) + Vite |
| Styling | Tailwind CSS v3 |
| Maps | Leaflet + react-leaflet |
| Backend/Scraping | Python 3.12 + Scrapy + BeautifulSoup4 + Selenium |
| Data Storage | JSON files (initial) → Supabase (future) |
| Notifications | SendGrid free tier |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages (frontend) |

---

## Running Locally

### Frontend
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
cp config.example.py config_local.py   # add your API keys
python main.py --dry-run               # test without writing data
python main.py                         # full run
```

### Run Tests
```bash
# Python tests
cd scraper && python -m pytest tests/ -v

# TypeScript type check
cd frontend && npm run type-check

# Frontend lint
cd frontend && npm run lint
```

---

## Coding Conventions

### TypeScript
- Strict mode enabled — no `any` types
- All props must have explicit interfaces
- Use named exports (not default exports for components)
- Functional components only, no class components
- Use `const` arrow functions for components: `const MyComponent = () => {}`
- Imports: React first, then third-party, then local (sorted alphabetically within groups)

### Python
- Type hints on all functions (use `from __future__ import annotations`)
- Docstrings on all public methods
- Ruff for linting and formatting (`ruff check .` and `ruff format .`)
- pytest for tests, minimum 80% coverage on scoring engine
- Never commit API keys — use environment variables

### Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`
- Branch naming: `feature/description`, `fix/description`
- Never force-push to `main`

---

## Adding New Scraper Sources

See `.claude/skills/scraper-dev/SKILL.md` for detailed instructions.

**Quick summary:**
1. Create `scraper/sources/mysource.py` extending `BaseScraper`
2. Implement `fetch()`, `parse()`, and `normalize()` methods
3. Register in `scraper/main.py`
4. Add tests in `scraper/tests/test_mysource.py`

---

## Deal Scoring

See `.claude/skills/data-analysis/SKILL.md` for scoring details.

Key factors:
- Price per acre vs. regional median (40% weight)
- Property features (water, road, electric, zoning) (30% weight)
- Days on market (20% weight)
- Source reliability (10% weight)

Score 0–100. Scores ≥ 75 trigger email notifications.

---

## Frontend Component Patterns

See `.claude/skills/frontend-dev/SKILL.md` for patterns.

---

## Deployment

- **GitHub Pages**: Deployed automatically on push to `main` via `deploy-pages.yml`
- **Scraping**: Runs daily via `scrape.yml` cron schedule
- **Secrets needed in GitHub repo settings:**
  - `SENDGRID_API_KEY`
  - `NOTIFICATION_EMAIL`

---

## Known Constraints
- County tax sale scrapers require JavaScript rendering (use Selenium)
- LandWatch and Lands of America have rate limiting — use delays in scrapers
- BLM data is available as CSV downloads, not scraped
- GitHub Pages serves static files only — no server-side logic
