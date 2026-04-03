# Rolling Context — Homestead Finder

> **For Claude:** Read this at the start of every session to understand current project state.
> Update the "Current Session" and "Recent Sessions" sections before ending each session.
> See `.claude/CLAUDE.md` for full project rules and conventions.

---

## Quick State Summary

| Item | Status |
|------|--------|
| Last Updated | 2024-01-15 |
| Current Phase | Initial project setup |
| Dashboard | Scaffolded, not yet deployed |
| Scraper | Scaffolded, not yet tested against live sites |
| GitHub Pages | Not yet configured |
| Data | Sample data only (10 listings) |
| Notifications | SendGrid integrated but not configured |

---

## What's Built

### Completed
- Full project structure created
- React + TypeScript frontend (Dashboard, Map, List, Filters, Property Detail, Notifications)
- Python scraper framework (7 sources: LandWatch, Lands of America, Zillow, Realtor, County Tax, Auction, BLM)
- Deal scoring engine with regional medians
- GitHub Actions (daily scraper cron, Pages deploy, test CI)
- Claude Code config (.claude/ with CLAUDE.md, settings, hooks, skills, agents, commands)
- DevContainer configuration for Codespaces
- Rolling context system (this file)

### Not Yet Done
- [ ] `npm install` + `npm run build` verified locally
- [ ] Python tests verified locally (`pytest tests/ -v`)
- [ ] GitHub Pages enabled on the repo
- [ ] SendGrid API key and NOTIFICATION_EMAIL secrets set in GitHub repo
- [ ] Live scraper run against actual sites
- [ ] Geocoding for listings without lat/lng
- [ ] `package-lock.json` generated (run `npm install`)

---

## Open Questions

1. **Which states should be the initial focus?** Currently: MT, ID, WY, CO, NM, OR, TX, TN, MN, ME
2. **Notification threshold** — Currently 75/100. Adjust based on deal volume.
3. **LandWatch and Lands of America** HTML structure needs verification — selectors may need updating after a live test
4. **County tax sale URLs** — Only a handful of counties in `county_tax.py`. Need to expand.
5. **Geocoding** — Many listings will be missing lat/lng. Consider adding a geocoder (Nominatim is free).

---

## Current Priorities (see BACKLOG.md for full list)

1. **Verify build works** — `cd frontend && npm install && npm run build`
2. **Verify Python tests pass** — `cd scraper && pytest tests/ -v`
3. **Enable GitHub Pages** — Set up in repo Settings → Pages → Source: GitHub Actions
4. **Test scraper on live sites** — `python main.py --dry-run --source=landwatch --states=MT`
5. **Add geocoding** — Most scrapers don't return lat/lng

---

## Recent Sessions

### Session 1 — 2024-01-15
**What was done:** Initial project scaffolding. Created all files per spec.
**Decisions made:**
- Used Vite + React + TypeScript (not CRA — faster, modern)
- JSON files as initial data store (Supabase migration noted in backlog)
- Feature taxonomy defined in `property.ts` and `scoring.py`
- Scoring weights: price 40%, features 30%, DOM 20%, source 10%
**Open questions from this session:**
- Scraper HTML selectors need live testing
- County tax sale URLs are placeholders for most counties

---

## Architecture Decisions

See `context/DECISIONS.md` for full ADR log.

---

## Known Issues / Blockers

| Issue | Severity | Notes |
|-------|----------|-------|
| Scraper selectors untested | Medium | LandWatch / LoA HTML may have changed |
| Missing lat/lng in most scrapers | Medium | Map will show 0,0 for many listings |
| County tax sale coverage sparse | Low | Only 4 counties currently covered |
| Zillow/Realtor disabled by default | Low | Rate limiting — enable carefully |
