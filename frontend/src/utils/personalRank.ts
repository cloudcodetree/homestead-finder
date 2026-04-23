import { Property } from '../types/property';

/**
 * Mirror of `scraper/rank_fit.py:_extract_features()`.
 *
 * MUST stay in lockstep with the Python version. If you add or
 * remove a feature key here, update the Python side in the same PR
 * — the fitted `weights` jsonb and this extractor share a schema
 * and any mismatch silently produces garbage rankings.
 *
 * Continuous features are rescaled so typical values land near [0,1].
 * Binary features stay as 0/1. Bias is stored under the `__bias__`
 * key in the weights map.
 */

const FEATURE_FLAGS = [
  'water_well',
  'water_creek',
  'water_pond',
  'road_paved',
  'road_dirt',
  'electric',
  'septic',
  'structures',
  'timber',
  'pasture',
  'hunting',
] as const;

const STATE_FLAGS = ['MO', 'AR'] as const;

const log1p = Math.log1p;

export const extractFeatures = (p: Property): Record<string, number> => {
  const price = p.price ?? 0;
  const acres = p.acreage ?? 0;
  const ppa = p.pricePerAcre ?? 0;
  const deal = p.dealScore ?? 0;
  const fit = p.homesteadFitScore ?? 0;
  const state = (p.location?.state ?? '').toUpperCase();
  const feats = new Set(p.features ?? []);
  const red = p.redFlags ?? [];

  const vec: Record<string, number> = {
    log_price: log1p(price) / 15,
    log_acres: log1p(acres) / 10,
    ppa_norm: Math.min(ppa / 10_000, 3),
    deal_score: deal / 100,
    fit_score: fit / 100,
    has_red_flags: red.length > 0 ? 1 : 0,
  };
  for (const flag of FEATURE_FLAGS) {
    vec[`feat_${flag}`] = feats.has(flag) ? 1 : 0;
  }
  for (const st of STATE_FLAGS) {
    vec[`state_${st}`] = state === st ? 1 : 0;
  }
  return vec;
};

/**
 * Score a listing with a user's fitted logistic-regression weights.
 * Returns a value in [0, 1] — the probability the user would save
 * this listing if they saw it. Higher = more likely to be recommended.
 *
 * `weights` includes `__bias__` alongside the per-feature weights.
 */
export const scoreWithWeights = (
  p: Property,
  weights: Record<string, number>,
): number => {
  if (!weights || Object.keys(weights).length === 0) return 0;
  const feats = extractFeatures(p);
  const bias = weights.__bias__ ?? 0;
  let z = bias;
  for (const [k, v] of Object.entries(feats)) {
    z += (weights[k] ?? 0) * v;
  }
  // Sigmoid — clamped exponent guards overflow on extreme inputs
  const clamped = Math.max(-40, Math.min(40, z));
  return 1 / (1 + Math.exp(-clamped));
};
