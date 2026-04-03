# Skill: Scraper Development

## Purpose
Add, debug, and maintain property listing scrapers for the homestead-finder project.

## Architecture

All scrapers live in `scraper/sources/` and extend `BaseScraper` from `scraper/sources/base.py`.

```
scraper/
├── sources/
│   ├── base.py          ← All scrapers extend this
│   ├── landwatch.py     ← Example implementation
│   └── your_source.py   ← New scrapers go here
├── main.py              ← Orchestrator — register new scrapers here
├── scoring.py           ← Deal scoring engine
└── config.py            ← Configuration (target states, price ranges)
```

## Adding a New Scraper Source

### Step 1 — Create the scraper file
```python
# scraper/sources/mysource.py
from __future__ import annotations
from .base import BaseScraper, RawListing

class MySourceScraper(BaseScraper):
    SOURCE_NAME = "mysource"
    BASE_URL = "https://www.mysource.com"
    RATE_LIMIT_SECONDS = 2.0  # Be respectful

    def fetch(self, state: str, max_pages: int = 5) -> list[dict]:
        """Fetch raw listing data from source."""
        # Use self.session for requests (has retry logic + user agent)
        results = []
        for page in range(1, max_pages + 1):
            response = self.session.get(
                f"{self.BASE_URL}/land-for-sale/{state.lower()}",
                params={"page": page}
            )
            if response.status_code != 200:
                break
            data = response.json()
            if not data.get("listings"):
                break
            results.extend(data["listings"])
            self.sleep()  # Respects RATE_LIMIT_SECONDS
        return results

    def parse(self, raw: dict) -> RawListing | None:
        """Parse a single raw listing dict into a RawListing."""
        try:
            return RawListing(
                external_id=str(raw["id"]),
                title=raw["title"],
                price=float(raw["price"]),
                acreage=float(raw["acres"]),
                state=raw["state"],
                county=raw.get("county", ""),
                lat=raw.get("lat"),
                lng=raw.get("lng"),
                features=self._extract_features(raw),
                url=f"{self.BASE_URL}/listing/{raw['id']}",
                raw=raw,
            )
        except (KeyError, ValueError, TypeError):
            return None  # Skip malformed listings

    def normalize(self, raw_listing: RawListing) -> dict:
        """Convert RawListing to the standard Property schema."""
        return self.to_property(raw_listing)  # BaseScraper handles this
```

### Step 2 — Register in main.py
```python
# In scraper/main.py, add to the SCRAPERS list:
from sources.mysource import MySourceScraper

SCRAPERS = [
    LandWatchScraper,
    LandsOfAmericaScraper,
    MySourceScraper,  # ← Add here
]
```

### Step 3 — Add tests
```python
# scraper/tests/test_mysource.py
import pytest
from sources.mysource import MySourceScraper

SAMPLE_RAW = {
    "id": "12345",
    "title": "40 Acres in Montana",
    "price": 120000,
    "acres": 40.0,
    "state": "MT",
    "county": "Missoula",
    "lat": 46.8721,
    "lng": -113.9940,
}

def test_parse_valid_listing():
    scraper = MySourceScraper(config={})
    result = scraper.parse(SAMPLE_RAW)
    assert result is not None
    assert result.acreage == 40.0
    assert result.price == 120000

def test_parse_missing_required_field():
    scraper = MySourceScraper(config={})
    result = scraper.parse({"id": "123"})  # Missing required fields
    assert result is None
```

## Dealing with JavaScript-Heavy Sites

For county tax sale sites or sites that require JS:

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

def fetch_with_selenium(self, url: str) -> str:
    """Use Selenium for JS-rendered pages."""
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=options)
    try:
        driver.get(url)
        driver.implicitly_wait(3)
        return driver.page_source
    finally:
        driver.quit()
```

## Rate Limiting Best Practices
- Always set `RATE_LIMIT_SECONDS >= 1.5` for public sites
- Use `self.sleep()` between requests (includes jitter)
- Check `robots.txt` before implementing; respect disallow rules
- Use `self.session` (pre-configured with realistic headers)

## Data Normalization

All scrapers must produce the `Property` schema defined in `frontend/src/types/property.ts`:

| Field | Type | Notes |
|-------|------|-------|
| id | string | `{source}_{external_id}` |
| title | string | Descriptive title |
| price | number | USD |
| acreage | number | Total acres |
| pricePerAcre | number | Calculated: price / acreage |
| location.lat | number | Required for map |
| location.lng | number | Required for map |
| location.state | string | 2-letter code |
| location.county | string | |
| features | string[] | See feature taxonomy below |
| source | string | Source name constant |
| url | string | Direct listing URL |
| dateFound | string | ISO 8601 |
| dealScore | number | 0–100, set by scoring engine |

### Feature Taxonomy
Use these exact strings for features array:
`water_well`, `water_creek`, `water_pond`, `road_paved`, `road_dirt`,
`electric`, `septic`, `structures`, `timber`, `pasture`, `hunting`,
`mineral_rights`, `no_hoa`, `off_grid_ready`, `owner_financing`
