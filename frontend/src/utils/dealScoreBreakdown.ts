import { Property, PropertyFeature } from '../types/property';

/**
 * Per-axis breakdown of the dealScore. Mirrors the formulas in
 * `scraper/scoring.py` so the detail panel can show the user exactly
 * how the score was assembled instead of dropping a number on them.
 *
 * Stays a pure function of the loaded `Property` — no extra fetches
 * or enrichment required.
 */
export interface DealAxis {
  key: 'price' | 'features' | 'dom' | 'source';
  label: string;
  /** Points earned on this axis (0 to maxPoints). */
  earned: number;
  /** Maximum points the axis can contribute to the composite. */
  maxPoints: number;
  /** Score normalized to 0-100 so the visual bars share the same
   * scale as InvestmentScore axes. */
  scoreOutOf100: number;
  /** Composite weight (`maxPoints / 100`). */
  weight: number;
  /** Short, sentence-case description of what produced this axis's
   * earned value for THIS listing. Surfaces the underlying signal —
   * e.g. "$1,200/ac vs TX median $2,500/ac (48%)" or "Days on market: 92". */
  rationale: string;
}

/** State → USDA-NASS regional median $/ac (mirrors REGIONAL_MEDIANS in
 *  scraper/scoring.py). Kept in sync by hand for now; if it drifts,
 *  the score column reads off; the panel always derives from this map. */
export const REGIONAL_MEDIANS: Record<string, number> = {
  MT: 450, ID: 850, WY: 500, CO: 1200, NM: 600, AZ: 800, UT: 1100, NV: 350,
  OR: 1500, WA: 2000, CA: 5000, TX: 2500, OK: 1800, KS: 2200, NE: 3000,
  SD: 1500, ND: 2000, MN: 3500, WI: 3000, MI: 2800, ME: 1200, VT: 2500,
  NH: 3000, NY: 3000, PA: 4000, TN: 3000, __default__: 2000,
};

/** Per-feature point value (mirrors FEATURE_VALUES). Sum capped at 30. */
export const FEATURE_VALUES: Record<PropertyFeature, number> = {
  water_well: 8,
  water_creek: 7,
  water_pond: 5,
  owner_financing: 5,
  off_grid_ready: 4,
  electric: 4,
  mineral_rights: 4,
  road_paved: 4,
  structures: 3,
  no_hoa: 2,
  timber: 2,
  pasture: 2,
  road_dirt: 2,
  septic: 2,
  hunting: 1,
};

/** Per-source motivation/reliability score (mirrors SOURCE_SCORES). */
export const SOURCE_SCORES: Record<string, number> = {
  county_tax: 10,
  govease: 10,
  auction: 9,
  blm: 8,
  landwatch: 6,
  lands_of_america: 6,
  realtor: 5,
  zillow: 4,
};

const priceAxis = (
  p: Property,
  override?: { median: number; scope: string },
): DealAxis => {
  const max = 40;
  const ppa = p.pricePerAcre ?? 0;
  const acres = p.acreage ?? 0;
  if (ppa <= 0 || acres <= 0) {
    // Tax-sale fallback — score by absolute price (kept identical to
    // scraper/scoring.py to avoid front/back drift).
    const price = p.price ?? 0;
    let earned = 0;
    let rationale: string;
    if (price <= 0) {
      earned = 0;
      rationale = 'No usable price data';
    } else if (price <= 500) {
      earned = 30;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $500 — likely tax sale)`;
    } else if (price <= 2000) {
      earned = 25;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $2k)`;
    } else if (price <= 5000) {
      earned = 20;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $5k)`;
    } else if (price <= 15_000) {
      earned = 15;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $15k)`;
    } else if (price <= 50_000) {
      earned = 10;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $50k)`;
    } else if (price <= 100_000) {
      earned = 5;
      rationale = `Absolute price $${price.toLocaleString()} (≤ $100k)`;
    } else {
      earned = 0;
      rationale = `Absolute price $${price.toLocaleString()} above all bands`;
    }
    return {
      key: 'price',
      label: 'Price',
      earned,
      maxPoints: max,
      scoreOutOf100: (earned / max) * 100,
      weight: max / 100,
      rationale,
    };
  }
  // Anchor: prefer the caller-supplied comp median (typically the
  // tightest pool from `findBestComps`), fall back to the static
  // USDA-NASS regional median when no comp pool is available. The
  // regional anchor is "what land typically costs in this state at
  // wholesale"; the comp anchor is "what this neighborhood is asking
  // right now". The latter is harsher — to score well you have to be
  // cheap *relative to your actual neighbors*, not just by Texas-wide
  // standards — but it's what users actually care about.
  const state = p.location?.state ?? '__default__';
  const median = override
    ? override.median
    : REGIONAL_MEDIANS[state] ?? REGIONAL_MEDIANS.__default__;
  const scope = override ? override.scope : `${state} median`;
  const ratio = ppa / median;
  let earned: number;
  let band: string;
  if (ratio <= 0.25) { earned = 40; band = `≤ 25% of ${scope}`; }
  else if (ratio <= 0.4) { earned = 35; band = `≤ 40% of ${scope}`; }
  else if (ratio <= 0.6) { earned = 28; band = `≤ 60% of ${scope}`; }
  else if (ratio <= 0.8) { earned = 20; band = `≤ 80% of ${scope}`; }
  else if (ratio <= 1.0) { earned = 12; band = `≤ ${scope}`; }
  else if (ratio <= 1.25) { earned = 5; band = `within 25% above ${scope}`; }
  else { earned = 0; band = `more than 25% above ${scope}`; }
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}/ac`;
  return {
    key: 'price',
    label: 'Price',
    earned,
    maxPoints: max,
    scoreOutOf100: (earned / max) * 100,
    weight: max / 100,
    rationale: `${fmt(ppa)} vs ${scope} ${fmt(median)} — ${band}`,
  };
};

const featureAxis = (p: Property): DealAxis => {
  const max = 30;
  const features = p.features ?? [];
  const total = features.reduce((sum, f) => sum + (FEATURE_VALUES[f] ?? 0), 0);
  const earned = Math.min(max, total);
  const rationale =
    features.length === 0
      ? 'No homesteading features detected on the listing'
      : `${features.length} feature${features.length === 1 ? '' : 's'}: ` +
        features
          .map((f) => `${f.replace(/_/g, ' ')} (+${FEATURE_VALUES[f] ?? 0})`)
          .join(', ');
  return {
    key: 'features',
    label: 'Features',
    earned,
    maxPoints: max,
    scoreOutOf100: (earned / max) * 100,
    weight: max / 100,
    rationale,
  };
};

const domAxis = (p: Property): DealAxis => {
  const max = 20;
  const dom = p.daysOnMarket ?? null;
  let earned: number;
  let rationale: string;
  if (dom === null) {
    earned = 8;
    rationale = 'Days on market unknown — assumed mid-range';
  } else if (dom >= 180) {
    earned = 20;
    rationale = `${dom} days on market — strong negotiating leverage`;
  } else if (dom >= 90) {
    earned = 15;
    rationale = `${dom} days on market — some leverage`;
  } else if (dom >= 30) {
    earned = 10;
    rationale = `${dom} days on market — fresh inventory`;
  } else if (dom >= 7) {
    earned = 5;
    rationale = `${dom} days on market — barely listed`;
  } else {
    earned = 0;
    rationale = `${dom} days on market — too fresh to negotiate`;
  }
  return {
    key: 'dom',
    label: 'Time on market',
    earned,
    maxPoints: max,
    scoreOutOf100: (earned / max) * 100,
    weight: max / 100,
    rationale,
  };
};

const sourceAxis = (p: Property): DealAxis => {
  const max = 10;
  const src = p.source ?? '';
  const earned = SOURCE_SCORES[src] ?? 5;
  const rationale =
    earned === 10
      ? `${src} — distress / forced-sale source, high deal probability`
      : earned >= 8
        ? `${src} — auction-style source, motivated sellers`
        : earned >= 6
          ? `${src} — standard land marketplace`
          : `${src} — general residential portal, low motivation signal`;
  return {
    key: 'source',
    label: 'Source motivation',
    earned,
    maxPoints: max,
    scoreOutOf100: (earned / max) * 100,
    weight: max / 100,
    rationale,
  };
};

/**
 * Build the four-axis breakdown for `dealScore`. The raw `dealScore`
 * stored on the Property is the integer sum of `earned` across all
 * axes (clamped to 0–100), originally computed by the scraper
 * against state-median anchors; the panel re-derives axis-by-axis so
 * the user can see *which* lever moved the number, and optionally
 * re-anchors the Price axis against a tighter neighborhood comp pool
 * (passed in by the caller). When that override is supplied, the
 * displayed score will diverge from the stored `dealScore` — the
 * displayed sum is the truthful one for the user's question
 * ("how does this stack up locally"), and the panel takes the sum of
 * `earned` values as the headline.
 */
export const computeDealScoreBreakdown = (
  p: Property,
  opts?: { priceAnchor?: { median: number; scope: string } },
): DealAxis[] => [
  priceAxis(p, opts?.priceAnchor),
  featureAxis(p),
  domAxis(p),
  sourceAxis(p),
];
