"""Tests for scraper/sources/tax_sale_analytics.py.

Pure-function tests — no network, no fixtures beyond the small dicts
defined here.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sources.tax_sale_analytics import (
    analyze,
    analyze_listings,
    compute_county_ppa_medians,
    compute_deed_investment_multiple,
    compute_lien_expected_return_pct,
    extract_acres,
    extract_parcel_type,
)


# ── extract_parcel_type ────────────────────────────────────────────────────


def test_parcel_type_acreage_wins_when_ac_present():
    # Even with PLSS notation, explicit AC makes this "acreage"
    assert extract_parcel_type("1.85 AC. DES. AS: SEC 14 T55N R99W") == "acreage"


def test_parcel_type_rural_when_plss_only():
    assert extract_parcel_type("SEC 14 T55N R99W") == "rural"
    assert extract_parcel_type("T55 R99 NE1/4") == "rural"


def test_parcel_type_town_lot_when_lot_block_notation():
    assert extract_parcel_type("O.T. LOT 8 BLK. 106") == "town_lot"
    assert extract_parcel_type("CARY ADD'N LOT 12 BLK. 5") == "town_lot"


def test_parcel_type_unknown_on_empty_or_garbage():
    assert extract_parcel_type("") == "unknown"
    assert extract_parcel_type("just some text") == "unknown"


# ── extract_acres ──────────────────────────────────────────────────────────


def test_extract_acres_simple_decimal():
    assert extract_acres("1.85 AC.") == 1.85


def test_extract_acres_whole_number():
    assert extract_acres("160 ACRES") == 160.0


def test_extract_acres_picks_largest_match():
    # Legal descriptions often list sub-parcels; we want the parent size
    assert extract_acres("55.3 AC parent, 5 AC sub, 2.1 AC out-lot") == 55.3


def test_extract_acres_caps_at_640():
    # A township section is 640 AC — anything larger is usually a typo
    assert extract_acres("7000 AC") is None
    assert extract_acres("640 AC") == 640.0


def test_extract_acres_none_when_no_match():
    assert extract_acres("LOT 8 BLK 106") is None
    assert extract_acres("") is None


# ── compute_county_ppa_medians ─────────────────────────────────────────────


def test_ppa_medians_excludes_tax_sale_rows():
    listings = [
        {
            "source": "landwatch",
            "pricePerAcre": 1000,
            "acreage": 10,
            "location": {"state": "WY", "county": "Park"},
        },
        {
            "source": "landwatch",
            "pricePerAcre": 1200,
            "acreage": 20,
            "location": {"state": "WY", "county": "Park"},
        },
        {
            "source": "county_tax",  # must be ignored
            "pricePerAcre": 50000,
            "acreage": 0.1,
            "location": {"state": "WY", "county": "Park"},
        },
    ]
    medians = compute_county_ppa_medians(listings)
    assert medians[("WY", "Park")] == 1100.0


def test_ppa_medians_requires_two_samples():
    """A single data point is too noisy to trust."""
    listings = [
        {
            "source": "landwatch",
            "pricePerAcre": 500,
            "acreage": 10,
            "location": {"state": "WY", "county": "SingleSample"},
        }
    ]
    assert ("WY", "SingleSample") not in compute_county_ppa_medians(listings)


def test_ppa_medians_skip_zero_or_missing():
    listings = [
        {
            "source": "landwatch",
            "pricePerAcre": 0,
            "acreage": 10,
            "location": {"state": "WY", "county": "X"},
        },
        {
            "source": "landwatch",
            "pricePerAcre": 1000,
            "acreage": 0,
            "location": {"state": "WY", "county": "X"},
        },
    ]
    assert compute_county_ppa_medians(listings) == {}


# ── compute_deed_investment_multiple ──────────────────────────────────────


def test_deed_multiple_positive_when_value_exceeds_costs():
    # 10 AC × $2k/ac = $20k est, $2k min bid, $5k title → $13k net / $2k = 6.5×
    assert compute_deed_investment_multiple(min_bid=2000, est_value=20000) == 6.5


def test_deed_multiple_negative_when_underwater():
    # Small lot, high costs: $1k est, $500 min bid, $5k title → -4500/500 = -9.0
    assert compute_deed_investment_multiple(min_bid=500, est_value=1000) == -9.0


def test_deed_multiple_none_without_value_estimate():
    assert compute_deed_investment_multiple(min_bid=1000, est_value=None) is None


def test_deed_multiple_none_on_zero_bid():
    assert compute_deed_investment_multiple(min_bid=0, est_value=10000) is None


# ── compute_lien_expected_return_pct ──────────────────────────────────────


def test_lien_return_without_value_is_weighted_interest_only():
    # With default 85% redemption rate, 14mo avg, 15%/yr rate:
    # 0.85 * (0.15 * 14/12) * 100 = 0.85 * 17.5 = 14.875 → rounds to 14.9
    r = compute_lien_expected_return_pct(min_bid=1000, est_value=None)
    assert 14.0 <= r <= 16.0


def test_lien_return_higher_when_large_value_and_low_bid():
    # If the parcel is worth far more than the bid AND owner doesn't
    # redeem, the lien holder gets the land for pennies → blended return ↑
    weak = compute_lien_expected_return_pct(min_bid=1000, est_value=1500)
    strong = compute_lien_expected_return_pct(min_bid=1000, est_value=50_000)
    assert strong > weak


def test_lien_return_none_on_zero_bid():
    assert compute_lien_expected_return_pct(min_bid=0, est_value=10_000) is None


# ── analyze (end-to-end enrichment of a tax-sale dict) ────────────────────


def _sample_tax_sale(
    legal: str,
    amount: float = 1000,
    state: str = "WY",
    county: str = "Park",
    state_type: str = "lien",
):
    return {
        "legalDescription": legal,
        "amountOwedUsd": amount,
        "state": state,
        "county": county,
        "stateType": state_type,
    }


def test_analyze_populates_all_derived_fields():
    ts = _sample_tax_sale("10 AC. SEC 14 T55 R99")
    medians = {("WY", "Park"): 1000.0}
    out = analyze(ts, medians)
    assert out["parcelType"] == "acreage"
    assert out["estimatedAcres"] == 10.0
    assert out["estimatedValueUsd"] == 10_000
    # lien state → expectedReturnPct set, investmentMultiple None
    assert out["investmentMultiple"] is None
    assert out["expectedReturnPct"] is not None
    assert any("Est. value" in n for n in out["analyticsNotes"])


def test_analyze_deed_state_uses_investment_multiple_not_return_pct():
    ts = _sample_tax_sale(
        "10 AC", amount=2000, state="WA", county="King", state_type="deed"
    )
    medians = {("WA", "King"): 5_000.0}
    out = analyze(ts, medians)
    # 10 AC × $5k = $50k est, $2k bid, $5k title → $43k / $2k = 21.5×
    assert out["investmentMultiple"] == 21.5
    assert out["expectedReturnPct"] is None


def test_analyze_falls_back_to_state_median_without_county_sample():
    ts = _sample_tax_sale("10 AC", county="ObscureCo")
    medians = {("WY", "Park"): 1000.0, ("WY", "Other"): 1500.0}
    out = analyze(ts, medians)
    # state median is median of [1000, 1500] = 1250 → 10 AC × 1250 = 12500
    assert out["estimatedValueUsd"] == 12_500


def test_analyze_no_value_when_no_acreage():
    ts = _sample_tax_sale("LOT 8 BLK 106")
    medians = {("WY", "Park"): 1000.0}
    out = analyze(ts, medians)
    assert out["parcelType"] == "town_lot"
    assert out["estimatedAcres"] is None
    assert out["estimatedValueUsd"] is None
    # Still produces an expectedReturnPct (redemption-only path)
    assert out["expectedReturnPct"] is not None


def test_analyze_produces_useful_notes_for_ui():
    ts = _sample_tax_sale("LOT 8 BLK 106")
    out = analyze(ts, county_median_ppa={})
    assert any("town lot" in n.lower() for n in out["analyticsNotes"])


# ── analyze_listings (mutates the whole corpus) ───────────────────────────


def test_analyze_listings_stamps_every_tax_sale_row():
    listings = [
        # LandWatch comp — provides the $/acre median
        {
            "source": "landwatch",
            "pricePerAcre": 1000,
            "acreage": 10,
            "location": {"state": "WY", "county": "Park"},
        },
        {
            "source": "landwatch",
            "pricePerAcre": 1200,
            "acreage": 20,
            "location": {"state": "WY", "county": "Park"},
        },
        # Tax-sale row — analytics should stamp it
        {
            "source": "county_tax",
            "status": "tax_sale",
            "taxSale": {
                "legalDescription": "5 AC. in SEC 14 T55 R99",
                "amountOwedUsd": 500,
                "state": "WY",
                "county": "Park",
                "stateType": "lien",
            },
        },
    ]
    analyze_listings(listings)
    ts = listings[2]["taxSale"]
    assert ts["parcelType"] == "acreage"
    assert ts["estimatedAcres"] == 5.0
    assert ts["estimatedValueUsd"] == 5_500  # 5 × 1100 (median)
    assert ts["expectedReturnPct"] is not None


def test_analyze_listings_is_idempotent():
    listings = [
        {
            "source": "county_tax",
            "status": "tax_sale",
            "taxSale": {
                "legalDescription": "10 AC",
                "amountOwedUsd": 1000,
                "state": "WY",
                "county": "Park",
                "stateType": "lien",
            },
        }
    ]
    analyze_listings(listings)
    first = dict(listings[0]["taxSale"])
    analyze_listings(listings)
    second = dict(listings[0]["taxSale"])
    assert first == second
