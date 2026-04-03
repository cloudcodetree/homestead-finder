# Skill: Data Analysis & Deal Scoring

## Purpose
Analyze property listings and score them as homesteading deals.

## Scoring Algorithm

The scoring engine lives in `scraper/scoring.py`. Scores range 0–100.

### Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Price per acre vs median | 40% | How much below regional median price/acre |
| Feature score | 30% | Presence of valuable homesteading features |
| Days on market | 20% | Longer = more negotiating leverage |
| Source reliability | 10% | How trustworthy the data source is |

### Price Score (0–40 points)
```python
def price_score(price_per_acre: float, state: str) -> float:
    median = REGIONAL_MEDIANS.get(state, NATIONAL_MEDIAN)
    ratio = price_per_acre / median
    if ratio <= 0.25:   return 40   # 75%+ below median
    if ratio <= 0.50:   return 35   # 50-75% below median
    if ratio <= 0.75:   return 25   # 25-50% below median
    if ratio <= 1.00:   return 15   # At or below median
    if ratio <= 1.25:   return 5    # Up to 25% above median
    return 0                         # More than 25% above median
```

### Feature Score (0–30 points)
```python
FEATURE_VALUES = {
    "water_well":       8,
    "water_creek":      7,
    "water_pond":       5,
    "road_paved":       4,
    "road_dirt":        2,
    "electric":         4,
    "owner_financing":  5,
    "mineral_rights":   4,
    "no_hoa":           2,
    "off_grid_ready":   3,
    "timber":           2,
    "septic":           2,
    "structures":       3,
}
# Score = min(sum of feature values, 30)
```

### Days on Market Score (0–20 points)
```python
def dom_score(days_on_market: int) -> float:
    if days_on_market >= 180:  return 20
    if days_on_market >= 90:   return 15
    if days_on_market >= 30:   return 10
    if days_on_market >= 7:    return 5
    return 0
```

### Source Score (0–10 points)
```python
SOURCE_SCORES = {
    "county_tax":        10,   # Most motivated sellers
    "auction":           9,
    "blm":               8,
    "landwatch":         6,
    "lands_of_america":  6,
    "realtor":           5,
    "zillow":            4,
}
```

## Regional Median Price Per Acre

Stored in `scraper/scoring.py` as `REGIONAL_MEDIANS`. Update periodically from USDA/NASS data.

Current rough estimates ($/acre):
```python
REGIONAL_MEDIANS = {
    "MT": 450, "ID": 850, "WY": 500, "CO": 1200,
    "NM": 600, "AZ": 800, "UT": 1100, "NV": 350,
    "OR": 1500, "WA": 2000, "CA": 5000,
    "TX": 2500, "OK": 1800, "KS": 2200, "NE": 3000,
    "SD": 1500, "ND": 2000, "MN": 3500, "WI": 3000,
    "MI": 2800, "ME": 1200, "VT": 2500, "NH": 3000,
    "NY": 3000, "PA": 4000,
    # Default fallback
    "__default__": 2000,
}
```

## Notification Threshold
Properties with `dealScore >= 75` trigger email notifications via `notifier.py`.

## Running Analysis Locally
```bash
cd scraper
python -c "
from scoring import ScoringEngine
from sources.landwatch import LandWatchScraper

engine = ScoringEngine()
# Test scoring a hypothetical property
score = engine.score({
    'price': 50000,
    'acreage': 40,
    'state': 'MT',
    'features': ['water_well', 'road_dirt', 'no_hoa'],
    'days_on_market': 120,
    'source': 'landwatch',
})
print(f'Deal score: {score}')
"
```

## Updating Regional Medians
1. Get latest USDA/NASS land value data from `https://www.nass.usda.gov/`
2. Update `REGIONAL_MEDIANS` dict in `scraper/scoring.py`
3. Re-run the scraper — existing listings will be re-scored on next run
4. Add an ADR entry in `context/DECISIONS.md`

## Analyzing Current Data
```bash
cd scraper
python -c "
import json
with open('../data/listings.json') as f:
    listings = json.load(f)
scores = [l['dealScore'] for l in listings]
print(f'Total: {len(listings)}')
print(f'Hot deals (>=75): {sum(1 for s in scores if s >= 75)}')
print(f'Good deals (>=65): {sum(1 for s in scores if s >= 65)}')
print(f'Average score: {sum(scores)/len(scores):.1f}')
"
```
