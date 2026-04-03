# /analyze-deals

Analyze current property listings and surface insights about deal quality.

## Usage
```
/analyze-deals [--min-score=65] [--state=MT] [--top=20]
```

## What This Command Does

1. Load `data/listings.json`
2. Run analysis:
   - Score distribution (histogram)
   - Top deals by state
   - Best price-per-acre by state
   - Feature frequency analysis
   - Source comparison
3. Display formatted summary
4. Optionally flag listings that should trigger notifications

## Example Output
```
=== Deal Analysis Report ===
Total listings: 387 | Last scraped: 2024-01-15

Score Distribution:
  Hot (≥80):  23 listings (6%)
  Good (≥65): 89 listings (23%)
  Fair (≥50): 156 listings (40%)
  Low (<50):  119 listings (31%)

Top States by Deal Quality:
  1. Montana (MT): avg score 71, 45 listings
  2. Idaho (ID): avg score 68, 38 listings
  ...

Top 5 Current Deals:
  1. [Score 91] 120 acres in Broadwater County, MT
     $72,000 | $600/acre | water_well, road_dirt, no_hoa
     → https://landwatch.com/listing/...

  2. [Score 87] 40 acres in Custer County, ID
     ...
```

## Adjusting Thresholds
If deal quality seems off, consider updating `scraper/scoring.py`:
- `REGIONAL_MEDIANS` — Update from USDA data
- Feature weights in `FEATURE_VALUES`
- Notification threshold (currently 75)
