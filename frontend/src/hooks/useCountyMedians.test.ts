import { describe, expect, it } from 'vitest';
import { Property } from '../types/property';
import { computeCountyMedians, getCountyStat } from './useCountyMedians';

const stub = (overrides: Partial<Property>): Property =>
  ({
    id: 'x',
    title: 'X',
    description: '',
    source: 'test',
    url: '',
    location: { lat: 0, lng: 0, state: 'MO', county: 'Reynolds County', address: '' },
    price: 0,
    pricePerAcre: 0,
    acreage: 1,
    dealScore: 0,
    features: [],
    images: [],
    dateFound: '2026-01-01',
    status: 'unverified',
    ...overrides,
  }) as Property;

describe('computeCountyMedians', () => {
  it('returns an empty map for an empty corpus', () => {
    expect(computeCountyMedians([]).size).toBe(0);
  });

  it('computes median + count per (state, county)', () => {
    const corpus = [
      stub({ id: 'a', pricePerAcre: 1000, location: { lat: 0, lng: 0, state: 'MO', county: 'Reynolds County', address: '' } }),
      stub({ id: 'b', pricePerAcre: 3000, location: { lat: 0, lng: 0, state: 'MO', county: 'Reynolds County', address: '' } }),
      stub({ id: 'c', pricePerAcre: 5000, location: { lat: 0, lng: 0, state: 'MO', county: 'Reynolds County', address: '' } }),
      stub({ id: 'd', pricePerAcre: 8000, location: { lat: 0, lng: 0, state: 'AR', county: 'Phillips County', address: '' } }),
    ];
    const map = computeCountyMedians(corpus);
    expect(map.size).toBe(2);
    const mo = getCountyStat(map, 'MO', 'Reynolds County');
    expect(mo).toEqual({ median: 3000, count: 3 });
    const ar = getCountyStat(map, 'AR', 'Phillips County');
    expect(ar).toEqual({ median: 8000, count: 1 });
  });

  it('lowercase-normalizes state + county for keys', () => {
    const corpus = [stub({ pricePerAcre: 1000, location: { lat: 0, lng: 0, state: 'mo', county: 'reynolds county', address: '' } })];
    const map = computeCountyMedians(corpus);
    // Key is canonicalized — looking up by the original-case input still works.
    expect(getCountyStat(map, 'MO', 'Reynolds County')?.count).toBe(1);
    expect(getCountyStat(map, 'mo', 'reynolds county')?.count).toBe(1);
  });

  it('excludes sold + pending listings', () => {
    const corpus = [
      stub({ id: 'live1', pricePerAcre: 1000, status: 'unverified' }),
      stub({ id: 'live2', pricePerAcre: 3000, status: 'active' }),
      stub({ id: 'sold', pricePerAcre: 999_999, status: 'expired' }),
      stub({ id: 'pending', pricePerAcre: 999_999, status: 'pending' }),
    ];
    const map = computeCountyMedians(corpus);
    const stat = getCountyStat(map, 'MO', 'Reynolds County');
    expect(stat?.count).toBe(2);
    expect(stat?.median).toBe(2000); // (1000 + 3000) / 2
  });

  it('excludes rows with non-positive pricePerAcre', () => {
    const corpus = [
      stub({ id: 'good', pricePerAcre: 1000 }),
      stub({ id: 'zero', pricePerAcre: 0 }),
      stub({ id: 'neg', pricePerAcre: -5 }),
    ];
    const stat = getCountyStat(computeCountyMedians(corpus), 'MO', 'Reynolds County');
    expect(stat?.count).toBe(1);
  });
});

describe('getCountyStat', () => {
  it('returns null when (state, county) is not in the map', () => {
    const map = computeCountyMedians([]);
    expect(getCountyStat(map, 'TX', 'Anywhere')).toBe(null);
  });

  it('returns null when state or county is undefined', () => {
    const map = computeCountyMedians([stub({ pricePerAcre: 1000 })]);
    // The underlying key uses empty strings, which don't match a real
    // entry — so undefined inputs return null in practice.
    expect(getCountyStat(map, undefined, undefined)).toBe(null);
  });
});
