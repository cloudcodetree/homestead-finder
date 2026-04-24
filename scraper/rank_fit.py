"""Personalized-ranking fit worker.

For each user with ≥ MIN_EXAMPLES save events, fit a logistic
regression over a hand-picked feature vector and write the resulting
weights back to user_ranking_weights. The frontend reads these weights
and offers a "Recommended for you" sort that blends them with dealScore.

Design notes:

  * **Positive examples** = listings this user has saved (from
    saved_listings). Every saved listing contributes ONE positive
    example.
  * **Negative examples** preference order:
      1. Explicit hides from hidden_listings (clean signal — the
         user affirmatively said "not interested").
      2. Random-sampled unsaved listings from the current corpus,
         used to pad out negatives when explicit hides are scarce.
    Target negatives:positives ratio = 3:1. When the user has fewer
    than 3×N_saves real hides, we top up with random samples.
  * **Model**: L2-regularized logistic regression, fitted by scipy
    L-BFGS-B. No sklearn dep — one function, ~20 lines.
  * **Features** are Python-computable from the listing JSON AND
    reproducible in the frontend, so users can apply the weights
    client-side without a round-trip. See `_extract_features()`.
  * **Normalization**: continuous features scaled by hand-picked
    divisors that keep most values in roughly [0, 1]. Avoids
    persisting a normalizer blob alongside the weights.

The script is idempotent and cheap — skips users whose fit is fresh
(< 24h) unless --force is passed.

Usage:
    python -m scraper.rank_fit
    python -m scraper.rank_fit --force
    python -m scraper.rank_fit --user <uuid>  # single user
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

import config
from logger import get_logger

log = get_logger("rank_fit")


# Minimum save events before we bother fitting. Below this a
# logistic regression is meaningless.
MIN_EXAMPLES = 5

# Negatives-to-positives ratio. 3:1 is a standard starting point for
# imbalanced binary classification with random-sampled negatives.
NEG_RATIO = 3

# L2 regularization strength. Higher = more shrinkage toward zero.
# With tiny training sets this has to be fairly aggressive.
L2_LAMBDA = 1.0

# How stale a fit has to be before we re-fit. Same user saving two
# listings a week doesn't warrant burning compute every night.
REFIT_AFTER = timedelta(hours=23)


# ── Feature extraction ─────────────────────────────────────────────
# Keep this in lockstep with the frontend's mirror in
# utils/personalRank.ts — adding or removing a key in either place
# without updating the other will silently skew the scoring.

_FEATURE_FLAGS = [
    "water_well",
    "water_creek",
    "water_pond",
    "road_paved",
    "road_dirt",
    "electric",
    "septic",
    "structures",
    "timber",
    "pasture",
    "hunting",
]

_STATE_FLAGS = ["MO", "AR"]


def _extract_features(listing: dict[str, Any]) -> dict[str, float]:
    """Turn a listing into a float feature vector. Returns a dict
    keyed by feature name so the frontend can re-derive the same
    values from the same Property object.

    Continuous features are rescaled to keep values in roughly
    [0, 1]; binary features stay as 0/1. Bias term is added by the
    caller (not here)."""
    price = float(listing.get("price") or 0)
    acres = float(listing.get("acreage") or 0)
    ppa = float(listing.get("pricePerAcre") or 0)
    deal = float(listing.get("dealScore") or 0)
    fit = float(listing.get("homesteadFitScore") or 0)
    loc = listing.get("location") or {}
    state = str(loc.get("state") or "").upper()
    feats = set(listing.get("features") or [])
    red = listing.get("redFlags") or []

    vec: dict[str, float] = {
        # log(1+x)/10 keeps price in [0, ~1.5]; similarly for acres.
        "log_price": math.log1p(price) / 15.0,
        "log_acres": math.log1p(acres) / 10.0,
        # price-per-acre: /10000 puts typical rural values (< $10k/ac)
        # in [0, 1]; premium land overflows slightly which is fine.
        "ppa_norm": min(ppa / 10_000.0, 3.0),
        "deal_score": deal / 100.0,
        "fit_score": fit / 100.0,
        "has_red_flags": 1.0 if red else 0.0,
    }
    for flag in _FEATURE_FLAGS:
        vec[f"feat_{flag}"] = 1.0 if flag in feats else 0.0
    for st in _STATE_FLAGS:
        vec[f"state_{st}"] = 1.0 if state == st else 0.0
    return vec


# ── Logistic regression via scipy L-BFGS-B ─────────────────────────


def _fit_logreg(
    X: list[list[float]], y: list[int], feature_names: list[str]
) -> tuple[dict[str, float], float]:
    """Return (weights_dict, bias). Uses scipy's L-BFGS-B — fast and
    deterministic enough for small datasets.

    Minimizes: -1/N * sum[y·log(σ(z)) + (1-y)·log(1-σ(z))] + L2/2 * ||w||²
    """
    try:
        import numpy as np
        from scipy.optimize import minimize
    except ImportError as e:
        log.info(f"[rank_fit] numpy/scipy not available: {e} — skipping fit")
        return {}, 0.0

    Xa = np.array(X, dtype=float)
    ya = np.array(y, dtype=float)
    n_features = Xa.shape[1]

    def _loss_and_grad(theta: "np.ndarray") -> tuple[float, "np.ndarray"]:
        w, b = theta[:-1], theta[-1]
        z = Xa @ w + b
        # Stable σ
        sig = 1.0 / (1.0 + np.exp(-z))
        eps = 1e-9
        nll = -np.mean(ya * np.log(sig + eps) + (1 - ya) * np.log(1 - sig + eps))
        reg = 0.5 * L2_LAMBDA * float(w @ w) / len(ya)
        err = (sig - ya) / len(ya)
        grad_w = Xa.T @ err + (L2_LAMBDA / len(ya)) * w
        grad_b = float(err.sum())
        return nll + reg, np.concatenate([grad_w, np.array([grad_b])])

    theta0 = np.zeros(n_features + 1)
    res = minimize(_loss_and_grad, theta0, jac=True, method="L-BFGS-B")
    w_final = res.x[:-1]
    b_final = float(res.x[-1])
    return (
        {name: float(w_final[i]) for i, name in enumerate(feature_names)},
        b_final,
    )


# ── Supabase wire-up ───────────────────────────────────────────────


def _supabase_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY", ""
    )
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY required for cross-user reads"
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _supabase_base() -> str:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL env var required")
    return base


def fetch_all_saves() -> list[dict[str, Any]]:
    """Pull every saved_listings row. With the expected user-base
    (single-digit users during beta) this is fine; revisit when we
    have >1k users and paginate."""
    url = (
        f"{_supabase_base()}/rest/v1/saved_listings"
        "?select=user_id,listing_id"
    )
    r = requests.get(url, headers=_supabase_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_all_hides() -> list[dict[str, Any]]:
    """Pull every hidden_listings row — used as explicit negative
    examples for the ranking model."""
    url = (
        f"{_supabase_base()}/rest/v1/hidden_listings"
        "?select=user_id,listing_id"
    )
    r = requests.get(url, headers=_supabase_headers(), timeout=30)
    if r.status_code == 404:
        # Migration 0004 not yet applied — treat as empty, caller
        # falls back to random-sampled negatives.
        return []
    r.raise_for_status()
    return r.json()


def fetch_existing_weights() -> dict[str, dict[str, Any]]:
    """Return {user_id: {fitted_at, ...}} for staleness checks."""
    url = (
        f"{_supabase_base()}/rest/v1/user_ranking_weights"
        "?select=user_id,fitted_at,num_examples"
    )
    r = requests.get(url, headers=_supabase_headers(), timeout=30)
    if r.status_code != 200:
        return {}
    return {row["user_id"]: row for row in r.json()}


def upsert_weights(
    user_id: str, weights: dict[str, float], num_examples: int
) -> bool:
    """Write/overwrite a user's weights row. Uses PostgREST upsert
    via Prefer: resolution=merge-duplicates."""
    url = f"{_supabase_base()}/rest/v1/user_ranking_weights"
    headers = {**_supabase_headers(), "Prefer": "resolution=merge-duplicates"}
    body = {
        "user_id": user_id,
        "weights": weights,
        "num_examples": num_examples,
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(url, headers=headers, json=body, timeout=15)
    if r.status_code not in (200, 201, 204):
        log.info(f"[rank_fit] upsert {user_id} failed: {r.status_code} {r.text[:200]}")
        return False
    return True


# ── Driver ─────────────────────────────────────────────────────────


def _load_listings_by_id() -> dict[str, dict[str, Any]]:
    p = config.DATA_DIR / "listings.json"
    if not p.exists():
        return {}
    try:
        rows = json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {r["id"]: r for r in rows if isinstance(r, dict) and r.get("id")}


def process_users(
    *, force: bool = False, user_filter: str | None = None
) -> int:
    """Main entry. Returns the number of users re-fit."""
    listings_by_id = _load_listings_by_id()
    if not listings_by_id:
        log.info("[rank_fit] no listings.json — nothing to fit against")
        return 0
    all_ids = list(listings_by_id.keys())

    try:
        saves = fetch_all_saves()
    except Exception as e:  # noqa: BLE001
        log.info(f"[rank_fit] could not fetch saved_listings: {e}")
        return 0

    # Explicit hides are optional — the model falls back to random
    # sampling when a user has few/no hides.
    try:
        hides = fetch_all_hides()
    except Exception as e:  # noqa: BLE001
        log.info(f"[rank_fit] could not fetch hidden_listings: {e}")
        hides = []

    # Bucket saves + hides by user
    per_user: dict[str, list[str]] = {}
    for row in saves:
        per_user.setdefault(row["user_id"], []).append(row["listing_id"])
    hides_by_user: dict[str, list[str]] = {}
    for row in hides:
        hides_by_user.setdefault(row["user_id"], []).append(row["listing_id"])

    existing = fetch_existing_weights()
    now = datetime.now(timezone.utc)
    fit_count = 0

    for user_id, saved_ids in per_user.items():
        if user_filter and user_id != user_filter:
            continue
        if len(saved_ids) < MIN_EXAMPLES:
            continue
        prev = existing.get(user_id)
        if prev and not force:
            try:
                fitted = datetime.fromisoformat(prev["fitted_at"].replace("Z", "+00:00"))
                if now - fitted < REFIT_AFTER:
                    continue
            except (ValueError, KeyError):
                pass

        # Positives — only saves whose listing is still in the corpus
        positives = [listings_by_id[i] for i in saved_ids if i in listings_by_id]
        if len(positives) < MIN_EXAMPLES:
            continue

        # Negatives: explicit hides first (clean signal), pad with
        # random-sampled unsaved listings when we're short.
        saved_set = set(saved_ids)
        target_neg_count = len(positives) * NEG_RATIO
        hide_ids = [
            i for i in hides_by_user.get(user_id, [])
            if i in listings_by_id and i not in saved_set
        ]
        explicit_negatives = [listings_by_id[i] for i in hide_ids]

        # Top up with random negatives (excluding both saves and hides)
        random.seed(hash(user_id) & 0x7fffffff)
        exclude = saved_set | set(hide_ids)
        candidate_negs = [i for i in all_ids if i not in exclude]
        needed = max(0, target_neg_count - len(explicit_negatives))
        sampled_ids = random.sample(
            candidate_negs, min(needed, len(candidate_negs))
        )
        random_negatives = [listings_by_id[i] for i in sampled_ids]
        negatives = explicit_negatives + random_negatives

        if explicit_negatives:
            log.info(
                f"[rank_fit] {user_id[:8]}: using "
                f"{len(explicit_negatives)} explicit hides + "
                f"{len(random_negatives)} random negatives"
            )

        # Build feature matrix
        feature_names = sorted(_extract_features(positives[0]).keys())
        X: list[list[float]] = []
        y: list[int] = []
        for row in positives:
            feats = _extract_features(row)
            X.append([feats.get(k, 0.0) for k in feature_names])
            y.append(1)
        for row in negatives:
            feats = _extract_features(row)
            X.append([feats.get(k, 0.0) for k in feature_names])
            y.append(0)

        weights, bias = _fit_logreg(X, y, feature_names)
        if not weights:
            continue
        weights["__bias__"] = bias
        if upsert_weights(user_id, weights, len(X)):
            fit_count += 1
            log.info(
                f"[rank_fit] {user_id[:8]}: fit on {len(positives)}pos/"
                f"{len(negatives)}neg → updated"
            )

    return fit_count


def main() -> None:
    ap = argparse.ArgumentParser(prog="rank_fit")
    ap.add_argument("--force", action="store_true", help="Re-fit even fresh models")
    ap.add_argument("--user", help="Only re-fit this user UUID")
    args = ap.parse_args()
    n = process_users(force=args.force, user_filter=args.user)
    log.info(f"[rank_fit] fit {n} users")


if __name__ == "__main__":
    main()
