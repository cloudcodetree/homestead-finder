import { describe, expect, it } from 'vitest';
import { Property } from '../types/property';
import { computeMarketStats, formatVsMedian } from './marketStats';

const stub = (overrides: Partial<Property>): Property =>
  ({
    id: overrides.id ?? 'x',
    title: 'Stub',
    description: '',
    source: 'test',
    url: 'https://example.com',
    location: { lat: 0, lng: 0, state: 'MO', county: 'Reynolds County', address: '' },
    price: 100_000,
    pricePerAcre: 1000,
    acreage: 100,
    dealScore: 50,
    features: [],
    images: [],
    dateFound: '2026-01-01',
    status: 'unverified',
    ...overrides,
  }) as Property;

/**
 * Market stats are surfaced both as a "p25" / "12% below county"
 * badge on the card AND as a comp panel inside PropertyDetail.
 * Wrong numbers here would mislead buyers in measurable dollars,
 * so the math gets a focused test.
 */
describe('computeMarketStats', () => {
  it('returns nulls when comp pool is empty', () => {
    const subject = stub({ id: 'a', pricePerAcre: 5000 });
    const stats = computeMarketStats(subject, [subject]);
    expect(stats.countyComps).toBe(0);
    expect(stats.countyMedianPricePerAcre).toBe(null);
    expect(stats.countyPercentile).toBe(null);
    expect(stats.similarListings).toEqual([]);
  });

  it('computes county median + percentile rank correctly', () => {
    // Subject is cheaper than the median of the comp pool
    const subject = stub({ id: 'subj', pricePerAcre: 1000 });
    const corpus = [
      subject,
      stub({ id: 'a', pricePerAcre: 2000 }),
      stub({ id: 'b', pricePerAcre: 3000 }),
      stub({ id: 'c', pricePerAcre: 4000 }),
      stub({ id: 'd', pricePerAcre: 5000 }),
    ];
    const stats = computeMarketStats(subject, corpus);
    expect(stats.countyComps).toBe(4);
    expect(stats.countyMedianPricePerAcre).toBe(3500); // (3000+4000)/2
    // Subject 1000 is below all 4 comps → percentile 0
    expect(stats.countyPercentile).toBe(0);
  });

  it('excludes sold/pending rows from the comp pool', () => {
    const subject = stub({ id: 'subj', pricePerAcre: 1000 });
    const corpus = [
      subject,
      stub({ id: 'sold', pricePerAcre: 50_000, status: 'expired' }),
      stub({ id: 'pending', pricePerAcre: 50_000, status: 'pending' }),
      stub({ id: 'live', pricePerAcre: 2000 }),
    ];
    const stats = computeMarketStats(subject, corpus);
    expect(stats.countyComps).toBe(1);
    expect(stats.countyMedianPricePerAcre).toBe(2000);
  });

  it('returns top-5 similar listings closest in $/acre, within ±50% acreage', () => {
    const subject = stub({ id: 'subj', pricePerAcre: 1000, acreage: 100 });
    const corpus = [
      subject,
      stub({ id: 'tooSmall', pricePerAcre: 1000, acreage: 10 }), // outside 50% band
      stub({ id: 'tooBig', pricePerAcre: 1000, acreage: 1000 }), // outside 50% band
      stub({ id: 'inBand1', pricePerAcre: 1100, acreage: 100 }),
      stub({ id: 'inBand2', pricePerAcre: 950, acreage: 80 }),
      stub({ id: 'inBand3', pricePerAcre: 5000, acreage: 100 }), // far in $/acre
    ];
    const stats = computeMarketStats(subject, corpus);
    const ids = stats.similarListings.map((s) => s.id);
    expect(ids).toContain('inBand1');
    expect(ids).toContain('inBand2');
    expect(ids).not.toContain('tooSmall');
    expect(ids).not.toContain('tooBig');
    // closest in $/acre comes first — inBand2 (delta=50) beats inBand1 (delta=100)
    expect(ids[0]).toBe('inBand2');
  });
});

describe('formatVsMedian', () => {
  it('returns null when comp pool is too thin', () => {
    expect(formatVsMedian(1000, 1500, 'county', 5, 3)).toBe(null);
  });

  it('formats below/at/above with rounding', () => {
    // 1000 vs 2000 median = 50% below
    expect(formatVsMedian(1000, 2000, 'county', 5, 5)).toBe('50% below county');
    // exact match
    expect(formatVsMedian(2000, 2000, 'county', 5, 5)).toBe('at county median');
    // 25% above
    expect(formatVsMedian(2500, 2000, 'county', 5, 5)).toBe('25% above county');
  });

  it('returns null for zero or negative inputs', () => {
    expect(formatVsMedian(0, 1000, 'county')).toBe(null);
    expect(formatVsMedian(1000, 0, 'county')).toBe(null);
    expect(formatVsMedian(1000, null, 'county')).toBe(null);
  });
});
