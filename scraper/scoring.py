"""Deal scoring engine for homestead property listings."""
from __future__ import annotations

from typing import Any

# Regional median price per acre (USD) — update from USDA/NASS data annually
# Source: USDA NASS Land Values Summary
REGIONAL_MEDIANS: dict[str, float] = {
    "MT": 450, "ID": 850, "WY": 500, "CO": 1200,
    "NM": 600, "AZ": 800, "UT": 1100, "NV": 350,
    "OR": 1500, "WA": 2000, "CA": 5000,
    "TX": 2500, "OK": 1800, "KS": 2200, "NE": 3000,
    "SD": 1500, "ND": 2000, "MN": 3500, "WI": 3000,
    "MI": 2800, "ME": 1200, "VT": 2500, "NH": 3000,
    "NY": 3000, "PA": 4000, "TN": 3000,
    "__default__": 2000,
}

# Points value of each homesteading feature (max 30 total)
FEATURE_VALUES: dict[str, int] = {
    "water_well": 8,
    "water_creek": 7,
    "water_pond": 5,
    "owner_financing": 5,
    "off_grid_ready": 4,
    "electric": 4,
    "mineral_rights": 4,
    "road_paved": 4,
    "structures": 3,
    "no_hoa": 2,
    "timber": 2,
    "pasture": 2,
    "road_dirt": 2,
    "septic": 2,
    "hunting": 1,
}

# Source reliability / deal potential scores (max 10)
SOURCE_SCORES: dict[str, int] = {
    "county_tax": 10,
    "auction": 9,
    "blm": 8,
    "landwatch": 6,
    "lands_of_america": 6,
    "realtor": 5,
    "zillow": 4,
}


class ScoringEngine:
    """Scores property listings as homesteading deals (0–100)."""

    def score(self, property: dict[str, Any]) -> int:
        """Calculate a deal score 0–100 for a property."""
        total = (
            self._price_score(property)
            + self._feature_score(property)
            + self._dom_score(property)
            + self._source_score(property)
        )
        return min(100, max(0, round(total)))

    def _price_score(self, property: dict[str, Any]) -> float:
        """Price per acre vs. regional median (0–40 points)."""
        price_per_acre = property.get("pricePerAcre", 0)
        if price_per_acre <= 0:
            return 0

        state = property.get("location", {}).get("state", "__default__")
        median = REGIONAL_MEDIANS.get(state, REGIONAL_MEDIANS["__default__"])
        ratio = price_per_acre / median

        if ratio <= 0.25:
            return 40
        if ratio <= 0.40:
            return 35
        if ratio <= 0.60:
            return 28
        if ratio <= 0.80:
            return 20
        if ratio <= 1.00:
            return 12
        if ratio <= 1.25:
            return 5
        return 0

    def _feature_score(self, property: dict[str, Any]) -> float:
        """Homesteading feature score (0–30 points)."""
        features = property.get("features", [])
        total = sum(FEATURE_VALUES.get(f, 0) for f in features)
        return min(30, total)

    def _dom_score(self, property: dict[str, Any]) -> float:
        """Days on market score — longer = more leverage (0–20 points)."""
        dom = property.get("daysOnMarket")
        if dom is None:
            return 8  # Default: assume some time on market
        if dom >= 180:
            return 20
        if dom >= 90:
            return 15
        if dom >= 30:
            return 10
        if dom >= 7:
            return 5
        return 0

    def _source_score(self, property: dict[str, Any]) -> float:
        """Source reliability/motivation score (0–10 points)."""
        source = property.get("source", "")
        return SOURCE_SCORES.get(source, 5)

    def score_all(self, properties: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Score a list of properties in place and return them."""
        for prop in properties:
            prop["dealScore"] = self.score(prop)
        return properties
