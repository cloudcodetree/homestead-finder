import { Property } from '../types/property';

/**
 * Property-as-stock analytics. Computes county-level and state-level
 * market context for a listing using the in-memory corpus we already
 * load — no extra fetches, no extra dependencies. The numbers are
 * approximate (small county samples, listing prices ≠ comps), but
 * they're directionally correct and far more informative than the
 * raw $/acre on a card.
 *
 * Methodology notes:
 *   - We use $/acre (not raw price) for per-acre comparison.
 *   - Percentiles use simple linear interpolation on the sorted
 *     samples — for typical sample sizes (20–500) this is fine.
 *   - "Similar listings" means same county and acreage within ±50%
 *     of the subject's, sorted by closeness in price-per-acre.
 *   - We include only `active`/`unverified`/`tax_sale` rows in the
 *     comparison set — sold/expired rows would skew the median to
 *     pre-sale prices and confuse buyers reading current inventory.
 */

export interface MarketStats {
  /** How many comparable listings we found in the same county. */
  countyComps: number;
  /** Median $/acre across the county comp set (excluding the subject). */
  countyMedianPricePerAcre: number | null;
  /** Subject's percentile rank in that distribution, 0–100.
   *  e.g. 25 means "cheaper than 75% of listings in this county". */
  countyPercentile: number | null;
  /** Same as above, but state-level. Useful when county sample is tiny. */
  stateMedianPricePerAcre: number | null;
  statePercentile: number | null;
  /** How many state rows we found. */
  stateComps: number;
  /** Top 5 nearest comps in the same county sorted by closest $/acre. */
  similarListings: Property[];
}

const isComparable = (p: Property): boolean => {
  if (!p.pricePerAcre || p.pricePerAcre <= 0) return false;
  if (p.status === 'expired' || p.status === 'pending') return false;
  return true;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const percentileRank = (xs: number[], v: number): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  // Count strictly-below + half of equal (ties get split). Standard
  // percentile-rank definition; avoids 0% / 100% extremes when there's
  // a single matching comp.
  let below = 0;
  let equal = 0;
  for (const x of sorted) {
    if (x < v) below++;
    else if (x === v) equal++;
    else break;
  }
  return Math.round(((below + equal / 2) / sorted.length) * 100);
};

export const computeMarketStats = (
  subject: Property,
  corpus: Property[],
): MarketStats => {
  const subjState = subject.location?.state ?? '';
  const subjCounty = subject.location?.county ?? '';
  const subjAcres = subject.acreage;
  const subjPricePerAcre = subject.pricePerAcre;

  const countyPool = corpus.filter(
    (p) =>
      p.id !== subject.id &&
      isComparable(p) &&
      p.location?.state === subjState &&
      p.location?.county === subjCounty,
  );
  const statePool = corpus.filter(
    (p) =>
      p.id !== subject.id &&
      isComparable(p) &&
      p.location?.state === subjState,
  );

  const countyPpa = countyPool.map((p) => p.pricePerAcre);
  const statePpa = statePool.map((p) => p.pricePerAcre);

  // Similar = same county, acreage within 50% band of subject.
  const similar = countyPool
    .filter((p) => {
      if (subjAcres <= 0) return true;
      const ratio = p.acreage / subjAcres;
      return ratio >= 0.5 && ratio <= 1.5;
    })
    .sort((a, b) => {
      const aDelta = Math.abs(a.pricePerAcre - subjPricePerAcre);
      const bDelta = Math.abs(b.pricePerAcre - subjPricePerAcre);
      return aDelta - bDelta;
    })
    .slice(0, 5);

  return {
    countyComps: countyPool.length,
    countyMedianPricePerAcre: median(countyPpa),
    countyPercentile:
      subjPricePerAcre > 0 ? percentileRank(countyPpa, subjPricePerAcre) : null,
    stateMedianPricePerAcre: median(statePpa),
    statePercentile:
      subjPricePerAcre > 0 ? percentileRank(statePpa, subjPricePerAcre) : null,
    stateComps: statePool.length,
    similarListings: similar,
  };
};

/**
 * Lightweight delta-vs-median string for a card. Returns null when
 * the comp pool is too thin to be meaningful (< 5 rows).
 *
 * Examples:
 *   "32% below county"
 *   "12% above county"
 *   "at county median"
 */
export const formatVsMedian = (
  subjectPpa: number,
  median: number | null,
  scope: string,
  minComps = 5,
  comps = minComps,
): string | null => {
  if (median === null || median <= 0 || subjectPpa <= 0) return null;
  if (comps < minComps) return null;
  const pct = Math.round(((subjectPpa - median) / median) * 100);
  if (pct === 0) return `at ${scope} median`;
  if (pct < 0) return `${Math.abs(pct)}% below ${scope}`;
  return `${pct}% above ${scope}`;
};
