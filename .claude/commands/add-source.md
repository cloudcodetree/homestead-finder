# /add-source

Add a new property listing data source to the scraper.

## Usage
```
/add-source [source-name] [source-url]
```

## What This Command Does

When invoked, Claude will:

1. **Research the source** — Fetch `[source-url]` and analyze its structure, check for an API, review `robots.txt`

2. **Create the scraper** — Generate `scraper/sources/[source_name].py` extending `BaseScraper` with:
   - `fetch()` — HTTP requests with proper rate limiting
   - `parse()` — Extract listing data from HTML/JSON
   - `normalize()` — Convert to standard Property schema

3. **Write tests** — Create `scraper/tests/test_[source_name].py` with:
   - Valid listing parse test
   - Missing field handling test
   - Feature extraction test

4. **Register the scraper** — Add to `SCRAPERS` list in `scraper/main.py`

5. **Update documentation** — Add to sources table in `README.md`

## Example
```
/add-source farmlender https://www.farmlender.com/land-for-sale
```

## Notes
- Always reads `.claude/skills/scraper-dev/SKILL.md` first
- Checks `robots.txt` before implementing
- Uses official API if available (preferred over HTML scraping)
- Sets conservative rate limits (2+ seconds between requests)
