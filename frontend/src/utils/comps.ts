import { Property } from '../types/property';

/** Which comp pool produced the median we're showing. Tracks how
 * tight the comparison is so we can label the tooltip honestly. */
export type CompPool = 'acreage_band' | 'nearby' | 'county';

/**
 * "Raw land" $/ac — what the parcel would be worth as bare homestead
 * land, with detected structures + utility improvements subtracted.
 * This is the right number to compare across listings: a $250k cabin
 * on 40ac and a bare 40ac with the same residual land value should
 * read as comparable, not as one being "60% above" the other purely
 * because of an existing dwelling.
 *
 * `residualPricePerAcre` is precomputed by the scraper from
 * `estimatedStructureValueUsd` (which already covers home/cabin/barn/
 * outbuilding *and* utility improvements like well/septic/electric).
 * Falls back to raw `pricePerAcre` for rows that predate the
 * improvements pass — those are typically bare-land anyway.
 */
export const rawLandPpa = (p: Property): number =>
  p.residualPricePerAcre && p.residualPricePerAcre > 0
    ? p.residualPricePerAcre
    : p.pricePerAcre;

export interface CompResult {
  median: number;
  count: number;
  pool: CompPool;
  /** Short human-readable description of the pool used —
   *  "8 nearby 0.3–0.6ac listings", "12 in Travis County",
   *  "5 within 25mi". Surfaced in the card tooltip. */
  poolLabel: string;
  /** The actual listings the median was computed from, sorted ascending
   *  by $/ac. The detail panel renders these so the user can audit the
   *  comparison instead of trusting an opaque median number. */
  comps: Property[];
  /** Acreage band used (only for `acreage_band` pool) — for the panel
   *  to display "comparing against 5–15 acre listings in Travis". */
  acreageBand?: { lo: number; hi: number };
  /** Radius used (only for `nearby` pool). */
  radiusMi?: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Haversine distance in miles between two lat/lng pairs. */
const distanceMiles = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const isUsableComp = (p: Property): boolean =>
  rawLandPpa(p) > 0 &&
  p.status !== 'expired' &&
  p.status !== 'pending';

/**
 * Coarse improvement-tier classifier matching the FilterPanel's
 * 'I'm looking for…' segmented control. Used to keep tier mismatches
 * out of the comp pool when cleaner pools exist (a bare 10ac and a
 * 10ac with cabin should ideally be compared against their own kind,
 * even though `rawLandPpa` already nets out the structure value).
 */
const tierOf = (p: Property): 'move_in_ready' | 'improved' | 'bare_land' => {
  if (p.moveInReady) return 'move_in_ready';
  if (p.improvements && Object.keys(p.improvements).length > 0) return 'improved';
  return 'bare_land';
};

/** Format an acreage band lower–upper as a compact range string. */
const formatAcreRange = (lo: number, hi: number): string => {
  const f = (v: number) =>
    v < 1 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString();
  return `${f(lo)}–${f(hi)}ac`;
};

/**
 * Return the tightest meaningful comp pool for the subject property,
 * walking a cascade of progressively wider neighborhood definitions
 * until one has ≥ minComps comparables:
 *
 *   1. **acreage_band** — same county + ±50% acreage + same improvement
 *      tier. Best signal because parcels in the same county at similar
 *      acreage and similar build state compete for the same buyer.
 *   2. **nearby (adaptive)** — start at 5mi by lat/lng and expand
 *      through 10/25/50/100mi until we hit ≥ minComps. The radius
 *      adapts to inventory density: dense metros stay tight, rural
 *      lookups grow until they find comparable listings.
 *   3. **county** — same county, any acreage. Last resort; only
 *      lands here when even a 100mi radius came up short.
 *
 * **All comparisons run on raw-land $/ac** (`residualPricePerAcre`
 * when set, otherwise `pricePerAcre`) so a $250k cabin-on-40ac
 * comparing to a bare 40ac doesn't read as "60% above" purely
 * because of the dwelling. Structures + utility improvements were
 * already netted out by `scraper/improvements.py`.
 *
 * Tier matching applies on the acreage_band tier — bare-land
 * subjects compare against bare-land comps, etc. The wider tiers
 * skip it because the rawLandPpa subtraction does most of the work
 * and forcing tier-match on a thin pool just makes us fall through
 * unnecessarily.
 *
 * Returns null only when even the county pool is < minComps. The
 * card UI shows "no comps" honestly in that case rather than quoting
 * a 2-row median.
 */
export const findBestComps = (
  subject: Property,
  corpus: readonly Property[],
  opts: { minComps?: number; bandPct?: number; radiiMi?: number[] } = {},
): CompResult | null => {
  const minComps = opts.minComps ?? 5;
  const bandPct = opts.bandPct ?? 0.5;
  // Adaptive radius cascade. Caps at 100mi — beyond that the "nearby"
  // pool is no longer geographically meaningful and we should fall
  // through to the county pool instead.
  const radii = opts.radiiMi ?? [5, 10, 25, 50, 100];

  const subjAcres = subject.acreage;
  const subjState = subject.location?.state;
  const subjCounty = subject.location?.county;
  const subjLat = subject.location?.lat;
  const subjLng = subject.location?.lng;
  const hasCoords =
    typeof subjLat === 'number' &&
    typeof subjLng === 'number' &&
    subjLat !== 0 &&
    subjLng !== 0;
  const subjTier = tierOf(subject);

  const buildResult = (
    pool: Property[],
    pump: Omit<CompResult, 'median' | 'count' | 'comps'>,
  ): CompResult => {
    const sorted = [...pool].sort((a, b) => rawLandPpa(a) - rawLandPpa(b));
    const ppa = sorted.map((p) => rawLandPpa(p));
    return {
      ...pump,
      median: median(ppa),
      count: sorted.length,
      comps: sorted,
    };
  };

  // 1) Acreage band within county + same improvement tier.
  if (subjAcres > 0 && subjState && subjCounty) {
    const lo = subjAcres * (1 - bandPct);
    const hi = subjAcres * (1 + bandPct);
    const pool = corpus.filter(
      (p) =>
        p.id !== subject.id &&
        isUsableComp(p) &&
        p.location?.state === subjState &&
        p.location?.county === subjCounty &&
        p.acreage >= lo &&
        p.acreage <= hi &&
        tierOf(p) === subjTier,
    );
    if (pool.length >= minComps) {
      return buildResult(pool, {
        pool: 'acreage_band',
        poolLabel: `${pool.length} nearby ${formatAcreRange(lo, hi)} listings in ${subjCounty}`,
        acreageBand: { lo, hi },
      });
    }
  }

  // 2) Adaptive nearby: expand the radius until we hit minComps or
  //    exhaust the cascade. Pre-compute distances once, then take
  //    the smallest radius that satisfies — saves recomputing the
  //    haversine for each tier.
  if (hasCoords) {
    const withDistance: Array<{ p: Property; d: number }> = [];
    for (const p of corpus) {
      if (p.id === subject.id) continue;
      if (!isUsableComp(p)) continue;
      const lat = p.location?.lat;
      const lng = p.location?.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number' || lat === 0 || lng === 0) {
        continue;
      }
      withDistance.push({ p, d: distanceMiles(subjLat, subjLng, lat, lng) });
    }
    for (const r of radii) {
      const pool = withDistance.filter((x) => x.d <= r).map((x) => x.p);
      if (pool.length >= minComps) {
        return buildResult(pool, {
          pool: 'nearby',
          poolLabel: `${pool.length} listings within ${r}mi`,
          radiusMi: r,
        });
      }
    }
  }

  // 3) County-wide, any acreage / any tier.
  if (subjState && subjCounty) {
    const pool = corpus.filter(
      (p) =>
        p.id !== subject.id &&
        isUsableComp(p) &&
        p.location?.state === subjState &&
        p.location?.county === subjCounty,
    );
    if (pool.length >= minComps) {
      return buildResult(pool, {
        pool: 'county',
        poolLabel: `${pool.length} listings in ${subjCounty}`,
      });
    }
  }

  return null;
};

/** Format a delta-vs-median line for the card.
 *
 *  Caller passes the subject's *raw-land* $/ac (use `rawLandPpa(p)`)
 *  so the comparison is apples-to-apples — both sides have already
 *  netted out structure + utility value. Returns null when subject
 *  has no usable $/ac (tax-sale rows, etc). The comp pool's scope
 *  label flows into the human text: "32% below nearby comps", "12%
 *  above similar lots", etc. */
export const formatVsComp = (
  subjectRawPpa: number,
  comp: CompResult | null,
): string | null => {
  if (!comp || subjectRawPpa <= 0) return null;
  const pct = Math.round(((subjectRawPpa - comp.median) / comp.median) * 100);
  const scope =
    comp.pool === 'acreage_band'
      ? 'similar lots'
      : comp.pool === 'nearby'
        ? 'nearby comps'
        : 'county';
  if (pct === 0) return `at ${scope} median`;
  if (pct < 0) return `${Math.abs(pct)}% below ${scope}`;
  return `${pct}% above ${scope}`;
};
