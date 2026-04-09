import { describe, it, expect, vi } from 'vitest';
import {
  loadListings,
  getListingById,
  getListingsByState,
  getStateStats,
} from '@/lib/listings';
import type { Property } from '@/types/property';

// Mock the raw data import
vi.mock('../data/listings.json', () => ({
  default: [
    {
      id: 'test_1',
      title: 'Test Listing 1',
      price: 100_000,
      acreage: 50,
      pricePerAcre: 2000,
      location: { lat: 45, lng: -111, state: 'MT', county: 'Madison' },
      features: ['water_well'],
      source: 'landwatch',
      url: 'https://example.com/1',
      dateFound: '2026-04-01',
      dealScore: 85,
    },
    {
      id: 'test_2',
      title: 'Test Listing 2',
      price: 50_000,
      acreage: 20,
      pricePerAcre: 2500,
      location: { lat: 42, lng: -121, state: 'OR', county: 'Klamath' },
      features: ['water_creek'],
      source: 'county_tax',
      url: 'https://example.com/2',
      dateFound: '2026-04-02',
      dealScore: 72,
    },
  ] satisfies Property[],
}));

describe('loadListings', () => {
  it('returns all listings from the data file', () => {
    const listings = loadListings();
    expect(listings.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to sample data when data file is empty', async () => {
    // Reset modules so the dynamic import below gets a fresh copy of
    // @/lib/listings with a cleared _cache, and re-mock the data file
    // to simulate an empty listings.json.
    vi.resetModules();
    vi.doMock('../data/listings.json', () => ({ default: [] }));
    const { loadListings: loadFresh } = await import('@/lib/listings');
    const listings = loadFresh();
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0].id.startsWith('sample_')).toBe(true);
  });
});

describe('getListingById', () => {
  it('finds a listing by id', () => {
    const listing = getListingById('test_1');
    expect(listing?.title).toBe('Test Listing 1');
  });

  it('returns undefined for unknown id', () => {
    expect(getListingById('nonexistent')).toBeUndefined();
  });
});

describe('getListingsByState', () => {
  it('filters by state code', () => {
    const mt = getListingsByState('MT');
    expect(mt.every((l) => l.location.state === 'MT')).toBe(true);
    expect(mt.length).toBeGreaterThan(0);
  });

  it('returns empty array for state with no listings', () => {
    const xx = getListingsByState('XX');
    expect(xx).toEqual([]);
  });
});

describe('getStateStats', () => {
  it('computes stats for a state', () => {
    const stats = getStateStats('MT');
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.avgScore).toBeGreaterThanOrEqual(0);
    expect(stats.minPrice).toBeGreaterThan(0);
  });

  it('returns zero stats for state with no listings', () => {
    const stats = getStateStats('XX');
    expect(stats.count).toBe(0);
    expect(stats.avgScore).toBe(0);
  });
});
