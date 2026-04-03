# GitHub Copilot Instructions — Homestead Finder

## Project Overview
A land/property deal finder for homesteading. Scrapes listings nationwide, scores deals, and displays them on a dashboard.

## Tech Stack
- **Frontend:** React 18 + TypeScript (strict) + Vite + Tailwind CSS + Leaflet
- **Backend/Scraping:** Python 3.12 + BeautifulSoup4 + Selenium
- **Data:** JSON files in `data/`
- **Notifications:** SendGrid
- **CI/CD:** GitHub Actions

## Key Conventions

### TypeScript
- Strict mode — no `any` types
- Named exports only for components
- All props must have explicit interfaces
- Tailwind for all styling

### Python
- Type hints on all functions
- Docstrings on public methods
- Ruff for linting (`ruff check . && ruff format .`)
- All scrapers extend `BaseScraper` from `scraper/sources/base.py`

### Data Schema
The canonical property schema is in `frontend/src/types/property.ts`.
All scrapers must produce JSON matching that schema.

## File Locations
- Scraper sources: `scraper/sources/`
- Frontend components: `frontend/src/components/`
- Type definitions: `frontend/src/types/property.ts`
- Sample data: `frontend/src/data/sample-listings.json`
- Scraped data: `data/listings.json`

## Adding a New Scraper
Extend `BaseScraper`, implement `fetch()`, `parse()`, `normalize()`, register in `main.py`.

## Deal Scoring
See `scraper/scoring.py`. Scores 0–100 based on price vs median, features, DOM, source.
Scores ≥ 75 trigger email notifications.
