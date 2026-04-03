"""Tests for the deal scoring engine."""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from scoring import ScoringEngine, REGIONAL_MEDIANS


@pytest.fixture
def engine() -> ScoringEngine:
    return ScoringEngine()


def make_property(
    price: float = 100_000,
    acreage: float = 40,
    state: str = "MT",
    features: list[str] | None = None,
    days_on_market: int | None = None,
    source: str = "landwatch",
) -> dict:
    return {
        "price": price,
        "acreage": acreage,
        "pricePerAcre": price / acreage if acreage else 0,
        "location": {"state": state, "county": "Test"},
        "features": features or [],
        "daysOnMarket": days_on_market,
        "source": source,
    }


class TestPriceScore:
    def test_excellent_deal_scores_max(self, engine: ScoringEngine) -> None:
        """Property at 20% of regional median gets full price score."""
        median = REGIONAL_MEDIANS["MT"]  # $450/acre
        prop = make_property(price=median * 0.2 * 40, acreage=40, state="MT")
        score = engine._price_score(prop)
        assert score == 40

    def test_above_median_scores_low(self, engine: ScoringEngine) -> None:
        """Property well above regional median scores 0."""
        median = REGIONAL_MEDIANS["MT"]
        prop = make_property(price=median * 2 * 40, acreage=40, state="MT")
        score = engine._price_score(prop)
        assert score == 0

    def test_at_median_scores_partial(self, engine: ScoringEngine) -> None:
        """Property at regional median gets some price score."""
        median = REGIONAL_MEDIANS["MT"]
        prop = make_property(price=median * 40, acreage=40, state="MT")
        score = engine._price_score(prop)
        assert 0 < score <= 15

    def test_unknown_state_uses_default(self, engine: ScoringEngine) -> None:
        """Unknown state falls back to national default."""
        prop = make_property(price=500 * 40, acreage=40, state="XX")
        score = engine._price_score(prop)
        assert 0 <= score <= 40

    def test_zero_price_per_acre_returns_zero(self, engine: ScoringEngine) -> None:
        prop = make_property(price=0, acreage=40)
        assert engine._price_score(prop) == 0


class TestFeatureScore:
    def test_water_well_scores_high(self, engine: ScoringEngine) -> None:
        prop = make_property(features=["water_well"])
        score = engine._feature_score(prop)
        assert score == 8

    def test_multiple_features_accumulate(self, engine: ScoringEngine) -> None:
        prop = make_property(features=["water_well", "electric", "no_hoa"])
        score = engine._feature_score(prop)
        assert score == 8 + 4 + 2  # 14

    def test_feature_score_capped_at_30(self, engine: ScoringEngine) -> None:
        prop = make_property(features=list(["water_well", "water_creek", "owner_financing",
                                            "electric", "mineral_rights", "road_paved",
                                            "structures", "off_grid_ready"]))
        score = engine._feature_score(prop)
        assert score == 30

    def test_no_features_scores_zero(self, engine: ScoringEngine) -> None:
        prop = make_property(features=[])
        assert engine._feature_score(prop) == 0

    def test_unknown_feature_ignored(self, engine: ScoringEngine) -> None:
        prop = make_property(features=["unknown_feature", "water_well"])
        assert engine._feature_score(prop) == 8


class TestDOMScore:
    def test_long_dom_scores_max(self, engine: ScoringEngine) -> None:
        prop = make_property(days_on_market=200)
        assert engine._dom_score(prop) == 20

    def test_no_dom_gets_default(self, engine: ScoringEngine) -> None:
        prop = make_property(days_on_market=None)
        assert engine._dom_score(prop) == 8

    def test_fresh_listing_scores_zero(self, engine: ScoringEngine) -> None:
        prop = make_property(days_on_market=2)
        assert engine._dom_score(prop) == 0

    def test_90_days_scores_15(self, engine: ScoringEngine) -> None:
        prop = make_property(days_on_market=100)
        assert engine._dom_score(prop) == 15


class TestSourceScore:
    def test_county_tax_scores_highest(self, engine: ScoringEngine) -> None:
        prop = make_property(source="county_tax")
        assert engine._source_score(prop) == 10

    def test_zillow_scores_lowest(self, engine: ScoringEngine) -> None:
        prop = make_property(source="zillow")
        assert engine._source_score(prop) == 4

    def test_unknown_source_gets_default(self, engine: ScoringEngine) -> None:
        prop = make_property(source="unknown")
        assert engine._source_score(prop) == 5


class TestScoreAll:
    def test_score_all_sets_deal_score(self, engine: ScoringEngine) -> None:
        props = [make_property(), make_property(price=5000, acreage=40)]
        scored = engine.score_all(props)
        for p in scored:
            assert "dealScore" in p
            assert 0 <= p["dealScore"] <= 100

    def test_excellent_deal_scores_high(self, engine: ScoringEngine) -> None:
        """County tax sale, well below median, lots of features, long DOM."""
        prop = make_property(
            price=450 * 0.20 * 120,   # 80% below MT median, 120 acres
            acreage=120,
            state="MT",
            features=["water_well", "water_creek", "timber", "hunting", "no_hoa"],
            days_on_market=180,
            source="county_tax",
        )
        scored = engine.score_all([prop])
        assert scored[0]["dealScore"] >= 75

    def test_overpriced_deal_scores_low(self, engine: ScoringEngine) -> None:
        """Zillow listing 3x over median with no features."""
        prop = make_property(
            price=450 * 3.0 * 5,   # 3x MT median, only 5 acres
            acreage=5,
            state="MT",
            features=[],
            days_on_market=2,
            source="zillow",
        )
        scored = engine.score_all([prop])
        assert scored[0]["dealScore"] <= 20
