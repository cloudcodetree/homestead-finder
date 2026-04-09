import type { Property } from '@/types/property';
import { SAMPLE_LISTINGS } from './sample-listings';
// The data file is copied from ../../data/listings.json (repo root) into
// web/data/ by scripts/copy-data.mjs as a prebuild step. This is required
// because Next.js/Turbopack blocks imports that escape the project root.
// When we migrate to Turso, this single import becomes a DB query.
import rawListings from '../data/listings.json';

// Cached listings — loaded once per process
let _cache: Property[] | null = null;

/**
 * Load all listings from the data file, falling back to sample data
 * when the file is empty (common during development or after failed scrapes).
 */
export function loadListings(): Property[] {
  if (_cache !== null) return _cache;

  const raw = rawListings as Property[];
  if (Array.isArray(raw) && raw.length > 0) {
    _cache = raw;
  } else {
    _cache = SAMPLE_LISTINGS;
  }
  return _cache;
}

/** Find a single listing by its id. */
export function getListingById(id: string): Property | undefined {
  return loadListings().find((l) => l.id === id);
}

/** Get all listings for a given state (2-letter code, case-insensitive). */
export function getListingsByState(state: string): Property[] {
  const upper = state.toUpperCase();
  return loadListings().filter((l) => l.location.state.toUpperCase() === upper);
}

export interface StateStats {
  count: number;
  avgScore: number;
  minPrice: number;
  maxPrice: number;
  totalAcreage: number;
  topSources: string[];
}

/** Compute aggregated statistics for a state. */
export function getStateStats(state: string): StateStats {
  const listings = getListingsByState(state);
  if (listings.length === 0) {
    return {
      count: 0,
      avgScore: 0,
      minPrice: 0,
      maxPrice: 0,
      totalAcreage: 0,
      topSources: [],
    };
  }

  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  const totalAcreage = listings.reduce((sum, l) => sum + (l.acreage || 0), 0);
  const scoreSum = listings.reduce((sum, l) => sum + l.dealScore, 0);

  // Top 3 sources by listing count
  const sourceCount = new Map<string, number>();
  for (const l of listings) {
    sourceCount.set(l.source, (sourceCount.get(l.source) ?? 0) + 1);
  }
  const topSources = [...sourceCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([source]) => source);

  return {
    count: listings.length,
    avgScore: Math.round(scoreSum / listings.length),
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    totalAcreage: Math.round(totalAcreage),
    topSources,
  };
}

/** Reset the cache (used by tests). */
export function _resetCache(): void {
  _cache = null;
}
