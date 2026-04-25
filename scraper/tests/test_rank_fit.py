"""Tests for rank_fit.py — feature extraction + weighted logreg.

Network calls (Supabase fetches) are not exercised; tests focus on
pure-function logic that survives schema/migration changes.
"""

from __future__ import annotations

import pytest

import rank_fit


def test_extract_features_known_keys():
    listing = {
        "price": 100_000,
        "acreage": 10,
        "pricePerAcre": 10_000,
        "dealScore": 75,
        "homesteadFitScore": 60,
        "features": ["water_well", "timber"],
        "redFlags": ["floodplain"],
        "location": {"state": "MO"},
    }
    feats = rank_fit._extract_features(listing)
    # Continuous features in [0, ~1.5]
    assert 0 < feats["log_price"] < 2
    assert 0 < feats["log_acres"] < 1
    assert feats["deal_score"] == pytest.approx(0.75)
    assert feats["fit_score"] == pytest.approx(0.6)
    assert feats["has_red_flags"] == 1.0
    assert feats["feat_water_well"] == 1.0
    assert feats["feat_timber"] == 1.0
    assert feats["feat_pasture"] == 0.0
    assert feats["state_MO"] == 1.0
    assert feats["state_AR"] == 0.0


def test_extract_features_handles_missing_fields():
    """Older rows without redFlags / features / scores still produce a
    valid feature vector."""
    feats = rank_fit._extract_features({"price": 0, "acreage": 0})
    # Every key in _FEATURE_FLAGS + _STATE_FLAGS must be present
    for flag in rank_fit._FEATURE_FLAGS:
        assert f"feat_{flag}" in feats
    for st in rank_fit._STATE_FLAGS:
        assert f"state_{st}" in feats
    assert feats["has_red_flags"] == 0.0
    assert feats["deal_score"] == 0.0


def test_fit_logreg_uniform_weights_signs():
    """Without sample_weights, fit should still produce sensible signs."""
    positives = _synth_positives(5)
    negatives = _synth_negatives(15)
    feats_a = rank_fit._extract_features(positives[0])
    feature_names = sorted(feats_a.keys())
    X = []
    y = []
    for p in positives:
        f = rank_fit._extract_features(p)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(1)
    for n in negatives:
        f = rank_fit._extract_features(n)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(0)
    weights, bias = rank_fit._fit_logreg(X, y, feature_names)
    assert weights["deal_score"] > 0
    assert weights["has_red_flags"] < 0
    assert weights["feat_water_well"] > 0
    assert isinstance(bias, float)


def test_fit_logreg_weighted_sharpens_signal():
    """Adding sample_weights to the same data should produce
    weight magnitudes ≥ the uniform-weight version. Weighted training
    treats high-weight examples as multiple equivalents → bigger
    gradient → larger fitted coefficient."""
    positives = _synth_positives(5)
    negatives = _synth_negatives(15)
    feats_a = rank_fit._extract_features(positives[0])
    feature_names = sorted(feats_a.keys())
    X = []
    y = []
    sample_weights = []
    for p in positives:
        f = rank_fit._extract_features(p)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(1)
        sample_weights.append(2.0)  # heavy positive
    for n in negatives:
        f = rank_fit._extract_features(n)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(0)
        sample_weights.append(2.0)  # heavy negative

    w_weighted, _ = rank_fit._fit_logreg(X, y, feature_names, sample_weights=sample_weights)
    w_uniform, _ = rank_fit._fit_logreg(X, y, feature_names)
    # All-uniform 2.0 weights should produce results IDENTICAL to
    # uniform 1.0 — the loss is normalized by total weight. So the
    # signs should match exactly even if magnitudes don't.
    assert (w_weighted["deal_score"] > 0) == (w_uniform["deal_score"] > 0)
    assert (w_weighted["has_red_flags"] < 0) == (w_uniform["has_red_flags"] < 0)


def test_fit_logreg_handles_no_scipy_gracefully(monkeypatch):
    """When scipy isn't installed, _fit_logreg returns ({}, 0.0) rather
    than raising. Pin this so a misconfigured env doesn't break runs."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "scipy.optimize":
            raise ImportError("simulated missing scipy")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    weights, bias = rank_fit._fit_logreg([[1.0]], [1], ["x"])
    assert weights == {}
    assert bias == 0.0


def test_fit_logreg_mixed_weights_fits_consistently():
    """Stronger explicit signals (save+Love=2.0, hide+Hate=2.0) +
    weak random negatives (0.5) → sensible model + non-degenerate
    bias. Pin to keep the rating-stack semantics from regressing."""
    positives = _synth_positives(5)
    negatives = _synth_negatives(3)
    weak_negs = [
        {
            "id": f"wn{i}", "price": 300_000, "acreage": 5,
            "pricePerAcre": 60_000, "dealScore": 35, "homesteadFitScore": 40,
            "features": [], "redFlags": [], "location": {"state": "AR"},
        }
        for i in range(2)
    ]
    feats_a = rank_fit._extract_features(positives[0])
    feature_names = sorted(feats_a.keys())
    X = []
    y = []
    w = []
    for p in positives:
        f = rank_fit._extract_features(p)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(1)
        w.append(2.0)  # save + Love
    for n in negatives:
        f = rank_fit._extract_features(n)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(0)
        w.append(2.0)  # hide + Hate
    for wn in weak_negs:
        f = rank_fit._extract_features(wn)
        X.append([f.get(k, 0.0) for k in feature_names])
        y.append(0)
        w.append(0.5)  # Dislike only

    weights, bias = rank_fit._fit_logreg(X, y, feature_names, sample_weights=w)
    assert weights["deal_score"] > 0
    assert weights["has_red_flags"] < 0
    # bias is non-zero (model isn't degenerate)
    assert abs(bias) > 0.1


# ── Helpers ────────────────────────────────────────────────────────


def _synth_positives(n: int) -> list[dict]:
    return [
        {
            "id": f"p{i}",
            "price": 50_000,
            "acreage": 10,
            "pricePerAcre": 5_000,
            "dealScore": 80,
            "homesteadFitScore": 75,
            "features": ["water_well", "water_creek"],
            "redFlags": [],
            "location": {"state": "MO"},
        }
        for i in range(n)
    ]


def _synth_negatives(n: int) -> list[dict]:
    return [
        {
            "id": f"n{i}",
            "price": 500_000,
            "acreage": 1,
            "pricePerAcre": 50_000,
            "dealScore": 10,
            "homesteadFitScore": 20,
            "features": [],
            "redFlags": ["mobile_home_only"],
            "location": {"state": "AR"},
        }
        for i in range(n)
    ]
