import { useMemo } from 'react';
import { DEFAULT_FILTERS, Property } from '../types/property';
import { useProperties } from './useProperties';

export interface CountyStat {
  median: number;
  count: number;
}

const stripeKey = (state: string | undefined, county: string | undefined): string =>
  `${(state ?? '').toLowerCase()}|${(county ?? '').toLowerCase()}`;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Pure computation of $/acre median per county across an arbitrary
 * listing list. Sold/pending rows are excluded so the median tracks
 * current inventory only.
 *
 * Returns a Map keyed by `state|county` (lowercased) → { median, count }.
 * Consumers should treat counts < 5 as too thin to display — see
 * `formatVsMedian` in utils/marketStats.ts.
 *
 * Exposed separately from the hook so it can be tested without
 * mocking the corpus loader.
 */
export const computeCountyMedians = (
  listings: Property[],
): Map<string, CountyStat> => {
  const groups = new Map<string, number[]>();
  for (const p of listings) {
    if (!p.pricePerAcre || p.pricePerAcre <= 0) continue;
    if (p.status === 'expired' || p.status === 'pending') continue;
    const key = stripeKey(p.location?.state, p.location?.county);
    const arr = groups.get(key);
    if (arr) arr.push(p.pricePerAcre);
    else groups.set(key, [p.pricePerAcre]);
  }
  const stats = new Map<string, CountyStat>();
  for (const [key, arr] of groups) {
    stats.set(key, { median: median(arr), count: arr.length });
  }
  return stats;
};

/**
 * Hook wrapper. Reads the loaded corpus via `useProperties` (cached
 * via `useJsonAsset`) and memoizes `computeCountyMedians` over it,
 * so all card mounts share one computed Map.
 */
export const useCountyMedians = () => {
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  return useMemo(() => computeCountyMedians(allProperties as Property[]), [allProperties]);
};

/** Convenience lookup helper used by cards. */
export const getCountyStat = (
  medians: Map<string, CountyStat>,
  state: string | undefined,
  county: string | undefined,
): CountyStat | null => medians.get(stripeKey(state, county)) ?? null;
