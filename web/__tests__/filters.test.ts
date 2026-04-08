import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTERS_STATE } from '@/lib/filters';
import type { Property, FilterState } from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';

const makeProperty = (overrides: Partial<Property>): Property => ({
  id: 'p1',
  title: 'Test',
  price: 50_000,
  acreage: 20,
  pricePerAcre: 2500,
  location: { lat: 0, lng: 0, state: 'MT', county: 'Madison' },
  features: [],
  source: 'landwatch',
  url: 'https://example.com',
  dateFound: '2026-04-01',
  dealScore: 70,
  ...overrides,
});

describe('applyFilters', () => {
  it('returns all listings with default filters', () => {
    const listings = [makeProperty({}), makeProperty({ id: 'p2' })];
    expect(applyFilters(listings, DEFAULT_FILTERS).length).toBe(2);
  });

  it('filters by minimum price', () => {
    const listings = [
      makeProperty({ price: 10_000 }),
      makeProperty({ id: 'p2', price: 100_000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, minPrice: 50_000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by maximum price', () => {
    const listings = [
      makeProperty({ price: 10_000 }),
      makeProperty({ id: 'p2', price: 100_000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, maxPrice: 50_000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by acreage range', () => {
    const listings = [
      makeProperty({ acreage: 5 }),
      makeProperty({ id: 'p2', acreage: 50 }),
      makeProperty({ id: 'p3', acreage: 500 }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      minAcreage: 10,
      maxAcreage: 100,
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by maxPricePerAcre', () => {
    const listings = [
      makeProperty({ pricePerAcre: 1000 }),
      makeProperty({ id: 'p2', pricePerAcre: 5000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, maxPricePerAcre: 2000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by minimum deal score', () => {
    const listings = [
      makeProperty({ dealScore: 50 }),
      makeProperty({ id: 'p2', dealScore: 85 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, minDealScore: 75 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by states (OR match)', () => {
    const listings = [
      makeProperty({ location: { lat: 0, lng: 0, state: 'MT', county: 'X' } }),
      makeProperty({
        id: 'p2',
        location: { lat: 0, lng: 0, state: 'OR', county: 'Y' },
      }),
      makeProperty({
        id: 'p3',
        location: { lat: 0, lng: 0, state: 'CA', county: 'Z' },
      }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, states: ['MT', 'OR'] };
    expect(applyFilters(listings, filters).length).toBe(2);
  });

  it('filters by features (AND match — must have all selected)', () => {
    const listings = [
      makeProperty({ features: ['water_well'] }),
      makeProperty({ id: 'p2', features: ['water_well', 'electric'] }),
      makeProperty({
        id: 'p3',
        features: ['water_well', 'electric', 'road_paved'],
      }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      features: ['water_well', 'electric'],
    };
    const result = applyFilters(listings, filters);
    expect(result.length).toBe(2);
    expect(result.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('filters by source', () => {
    const listings = [
      makeProperty({ source: 'landwatch' }),
      makeProperty({ id: 'p2', source: 'govease' }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      sources: ['govease'],
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('combines multiple filters with AND', () => {
    const listings = [
      makeProperty({ price: 50_000, dealScore: 60 }),
      makeProperty({ id: 'p2', price: 50_000, dealScore: 85 }),
      makeProperty({ id: 'p3', price: 200_000, dealScore: 85 }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      maxPrice: 100_000,
      minDealScore: 75,
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });
});
