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
    X: list[list[float]],
    y: list[int],
    feature_names: list[str],
    sample_weights: list[float] | None = None,
) -> tuple[dict[str, float], float]:
    """Return (weights_dict, bias). Uses scipy's L-BFGS-B — fast and
    deterministic enough for small datasets.

    Minimizes:
      -1/sum(w_i) * sum[w_i · (y·log(σ(z)) + (1-y)·log(1-σ(z)))] +
      L2/2 · ||w||²

    `sample_weights` lets callers up-weight stronger signals. None
    falls back to uniform 1.0 weights, identical to the original
    binary-only behavior. We need this to combine
    rating={Hate=-2, Dislike=-1, Like=+1, Love=+2} with save (+) and
    hide (-) into a single weighted training run.
    """
    try:
        import numpy as np
        from scipy.optimize import minimize
    except ImportError as e:
        log.info(f"[rank_fit] numpy/scipy not available: {e} — skipping fit")
        return {}, 0.0

    Xa = np.array(X, dtype=float)
    ya = np.array(y, dtype=float)
    if sample_weights is None:
        wa = np.ones(len(ya), dtype=float)
    else:
        wa = np.array(sample_weights, dtype=float)
    n_features = Xa.shape[1]
    total_w = float(wa.sum()) or 1.0

    def _loss_and_grad(theta: "np.ndarray") -> tuple[float, "np.ndarray"]:
        w, b = theta[:-1], theta[-1]
        z = Xa @ w + b
        sig = 1.0 / (1.0 + np.exp(-z))
        eps = 1e-9
        per_sample = ya * np.log(sig + eps) + (1 - ya) * np.log(1 - sig + eps)
        nll = -float((wa * per_sample).sum()) / total_w
        reg = 0.5 * L2_LAMBDA * float(w @ w) / total_w
        err = wa * (sig - ya) / total_w
        grad_w = Xa.T @ err + (L2_LAMBDA / total_w) * w
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


def fetch_all_ratings() -> list[dict[str, Any]]:
    """Pull every listing_ratings row. Each rating in {-2,-1,1,2} maps
    to a (label, sample_weight) pair feeding the weighted logreg fit.
    Returns empty list if the table doesn't exist yet (migration 0007
    not applied)."""
    url = (
        f"{_supabase_base()}/rest/v1/listing_ratings"
        "?select=user_id,listing_id,rating"
    )
    r = requests.get(url, headers=_supabase_headers(), timeout=30)
    if r.status_code == 404:
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

    # Ratings (-2..-1, 1..2) feed weighted training. Optional.
    try:
        ratings = fetch_all_ratings()
    except Exception as e:  # noqa: BLE001
        log.info(f"[rank_fit] could not fetch listing_ratings: {e}")
        ratings = []

    # Bucket saves + hides + ratings by user
    per_user: dict[str, list[str]] = {}
    for row in saves:
        per_user.setdefault(row["user_id"], []).append(row["listing_id"])
    hides_by_user: dict[str, list[str]] = {}
    for row in hides:
        hides_by_user.setdefault(row["user_id"], []).append(row["listing_id"])
    # ratings_by_user[user_id][listing_id] → rating in {-2,-1,1,2}
    ratings_by_user: dict[str, dict[str, int]] = {}
    for row in ratings:
        ratings_by_user.setdefault(row["user_id"], {})[row["listing_id"]] = int(
            row["rating"]
        )

    existing = fetch_existing_weights()
    now = datetime.now(timezone.utc)
    fit_count = 0

    # Combine all users with any signal — saves, hides, or ratings.
    # Previously we iterated only `per_user` (saves), so a user who
    # had only rated listings without saving anything got no model.
    all_user_ids = (
        set(per_user.keys()) | set(hides_by_user.keys()) | set(ratings_by_user.keys())
    )

    for user_id in all_user_ids:
        if user_filter and user_id != user_filter:
            continue
        saved_ids = per_user.get(user_id, [])
        user_ratings = ratings_by_user.get(user_id, {})
        # MIN_EXAMPLES is now satisfied if total positive signals
        # (saves OR ratings ≥ +1) reaches the threshold.
        positive_signal_count = len(saved_ids) + sum(
            1 for r in user_ratings.values() if r > 0
        )
        if positive_signal_count < MIN_EXAMPLES:
            continue
        prev = existing.get(user_id)
        if prev and not force:
            try:
                fitted = datetime.fromisoformat(prev["fitted_at"].replace("Z", "+00:00"))
                if now - fitted < REFIT_AFTER:
                    continue
            except (ValueError, KeyError):
                pass

        # Build training set with weighted signals. Each listing
        # contributes ONE training example with a (label, weight) pair
        # combining all signal sources for that listing:
        #   save           → label=1, weight += 1.0
        #   hide           → label=0, weight += 1.0
        #   rating Love    → label=1, weight += 1.0
        #   rating Like    → label=1, weight += 0.5
        #   rating Dislike → label=0, weight += 0.5
        #   rating Hate    → label=0, weight += 1.0
        # Same listing can have save+Love → label=1, weight=2.0 (strongest).
        # save + Dislike → label=conflicted; we resolve to label=1
        # (saves are stronger commitment than soft dislikes) but with
        # weight reduced by the dislike. The label/weight resolver below
        # handles all combinations.
        saved_set = set(saved_ids)
        hide_set = set(hides_by_user.get(user_id, []))

        def _label_and_weight(lid: str) -> tuple[int | None, float]:
            """Return (label, weight) for a listing or (None, 0) if no
            signal applies. Combines save / hide / rating per the
            scheme above."""
            saved = lid in saved_set
            hidden = lid in hide_set
            rating = user_ratings.get(lid, 0)
            pos_strength = 0.0
            neg_strength = 0.0
            if saved:
                pos_strength += 1.0
            if hidden:
                neg_strength += 1.0
            if rating == 2:
                pos_strength += 1.0
            elif rating == 1:
                pos_strength += 0.5
            elif rating == -1:
                neg_strength += 0.5
            elif rating == -2:
                neg_strength += 1.0
            if pos_strength == 0 and neg_strength == 0:
                return None, 0.0
            # Net signal: positive minus negative. If they exactly
            # cancel (save + Hate), drop the row — we can't tell.
            net = pos_strength - neg_strength
            if abs(net) < 0.01:
                return None, 0.0
            label = 1 if net > 0 else 0
            return label, abs(net)

        # Collect explicit (signal-bearing) examples first
        explicit: list[tuple[str, int, float]] = []  # (listing_id, label, weight)
        signal_ids = saved_set | hide_set | set(user_ratings.keys())
        for lid in signal_ids:
            if lid not in listings_by_id:
                continue
            lbl, w = _label_and_weight(lid)
            if lbl is None:
                continue
            explicit.append((lid, lbl, w))

        if not explicit:
            continue

        n_pos = sum(1 for _, lbl, _ in explicit if lbl == 1)
        n_neg = sum(1 for _, lbl, _ in explicit if lbl == 0)

        # Pad with random negatives to maintain NEG_RATIO when we're
        # short on explicit negatives. Each gets weight 0.5 (lower
        # confidence than explicit hides).
        target_neg_count = max(n_pos * NEG_RATIO, NEG_RATIO)
        random.seed(hash(user_id) & 0x7fffffff)
        exclude = signal_ids | saved_set | hide_set
        candidate_negs = [i for i in all_ids if i not in exclude]
        needed = max(0, target_neg_count - n_neg)
        sampled_ids = random.sample(
            candidate_negs, min(needed, len(candidate_negs))
        )
        random_negatives = [(i, 0, 0.5) for i in sampled_ids]

        all_examples = explicit + random_negatives
        if len(all_examples) < MIN_EXAMPLES:
            continue

        if explicit:
            log.info(
                f"[rank_fit] {user_id[:8]}: {n_pos} explicit positives + "
                f"{n_neg} explicit negatives + {len(random_negatives)} random "
                f"(ratings: {len(user_ratings)})"
            )

        # Build feature matrix
        first_listing = listings_by_id[all_examples[0][0]]
        feature_names = sorted(_extract_features(first_listing).keys())
        X: list[list[float]] = []
        y: list[int] = []
        weights_per_sample: list[float] = []
        for lid, lbl, w in all_examples:
            feats = _extract_features(listings_by_id[lid])
            X.append([feats.get(k, 0.0) for k in feature_names])
            y.append(lbl)
            weights_per_sample.append(w)

        weights, bias = _fit_logreg(
            X, y, feature_names, sample_weights=weights_per_sample
        )
        if not weights:
            continue
        weights["__bias__"] = bias
        if upsert_weights(user_id, weights, len(X)):
            fit_count += 1
            log.info(
                f"[rank_fit] {user_id[:8]}: fit on {len(all_examples)} examples → updated"
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
