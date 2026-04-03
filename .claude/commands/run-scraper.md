# /run-scraper

Run the property scraper locally to fetch fresh listings.

## Usage
```
/run-scraper [--dry-run] [--source=name] [--states=MT,ID,WY]
```

## What This Command Does

1. Navigate to `scraper/` directory
2. Check that `requirements.txt` deps are installed
3. Run `python main.py` with the specified options
4. Report how many listings were found per source
5. Show top 5 deals by score
6. If not `--dry-run`, confirm before writing to `data/listings.json`

## Options
- `--dry-run` — Fetch and score but don't write output files
- `--source=name` — Run only one scraper (e.g., `--source=landwatch`)
- `--states=MT,ID` — Override target states from config

## Prerequisites
```bash
cd scraper
pip install -r requirements.txt
# Set env vars if needed:
export SENDGRID_API_KEY=your_key
export NOTIFICATION_EMAIL=you@example.com
```

## Example Output
```
Running 7 scrapers across 8 states...
  ✓ LandWatch: 142 listings
  ✓ LandsOfAmerica: 89 listings
  ✓ CountyTax: 23 listings
  ...

Top deals:
  Score 87 | 80 acres, $38k | Madison County, MT | $475/acre
  Score 84 | 40 acres, $22k | Lemhi County, ID | $550/acre
  ...

Total: 387 listings → writing to data/listings.json
```
