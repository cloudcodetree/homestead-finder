import { describe, expect, it } from 'vitest';
import { Property } from '../types/property';
import { findBestComps, formatVsComp, rawLandPpa } from './comps';

const stub = (over: Partial<Property> = {}): Property => ({
  id: 'x',
  title: 't',
  price: 100_000,
  acreage: 10,
  pricePerAcre: 10_000,
  location: { lat: 30.27, lng: -97.74, state: 'TX', county: 'Travis', address: '' },
  features: [],
  source: 'landwatch',
  url: 'u',
  dateFound: '2026-01-01',
  dealScore: 50,
  status: 'active',
  ...over,
});

describe('findBestComps', () => {
  it('returns null when no pool clears the threshold', () => {
    const subject = stub({ id: 's' });
    expect(findBestComps(subject, [])).toBeNull();
  });

  it('prefers acreage_band when ≥ 5 same-county similar-acre comps exist', () => {
    const subject = stub({ id: 's', acreage: 10 });
    const corpus = Array.from({ length: 6 }, (_, i) =>
      // 8–12 acres = within ±50% of 10
      stub({ id: `c${i}`, acreage: 8 + i * 0.5, pricePerAcre: 5000 + i * 100 }),
    );
    const result = findBestComps(subject, corpus);
    expect(result?.pool).toBe('acreage_band');
    expect(result?.count).toBe(6);
    expect(result?.comps).toHaveLength(6);
    // sorted ascending by $/ac
    expect(result!.comps[0].pricePerAcre).toBeLessThanOrEqual(
      result!.comps[result!.comps.length - 1].pricePerAcre,
    );
    expect(result?.acreageBand).toEqual({ lo: 5, hi: 15 });
  });

  it('falls through to nearby when acreage band is too thin', () => {
    const subject = stub({ id: 's', acreage: 10 });
    // 3 same-county similar-acre (below threshold) + 5 other-county within 5mi
    const corpus = [
      ...Array.from({ length: 3 }, (_, i) =>
        stub({ id: `same${i}`, acreage: 9 + i * 0.5, pricePerAcre: 4000 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        // ~3.5 mi from subject — picked up by the 5mi tier of the cascade
        stub({
          id: `near${i}`,
          acreage: 50,
          pricePerAcre: 8000 + i * 100,
          location: {
            lat: 30.27 + 0.05,
            lng: -97.74,
            state: 'TX',
            county: 'Williamson',
            address: '',
          },
        }),
      ),
    ];
    const result = findBestComps(subject, corpus);
    expect(result?.pool).toBe('nearby');
    expect(result?.count).toBeGreaterThanOrEqual(5);
    // Adaptive: should land on the smallest tier that satisfies — 5mi.
    expect(result?.radiusMi).toBe(5);
  });

  it('adaptive radius expands until it finds enough comps', () => {
    const subject = stub({ id: 's', acreage: 10 });
    // 5 comps far enough that only the 50mi tier picks them up
    // (~30mi north of subject — outside 25mi but inside 50mi)
    const corpus = Array.from({ length: 5 }, (_, i) =>
      stub({
        id: `far${i}`,
        acreage: 50,
        pricePerAcre: 5000 + i * 100,
        location: {
          lat: 30.27 + 0.45,
          lng: -97.74,
          state: 'TX',
          county: 'Williamson',
          address: '',
        },
      }),
    );
    const result = findBestComps(subject, corpus);
    expect(result?.pool).toBe('nearby');
    expect(result?.radiusMi).toBe(50);
  });

  it('uses raw-land $/ac (residual) for the median, not asking', () => {
    const subject = stub({ id: 's', acreage: 10 });
    // 6 same-county similar-acre comps. Each has asking $10k/ac but
    // residual (after structures) of $4k/ac. Median should be 4000.
    const corpus = Array.from({ length: 6 }, (_, i) =>
      stub({
        id: `c${i}`,
        acreage: 9 + i * 0.3,
        pricePerAcre: 10_000,
        residualPricePerAcre: 4_000,
        // Match subject's tier (bare_land) so we hit acreage_band
      }),
    );
    const result = findBestComps(subject, corpus);
    expect(result?.median).toBe(4_000);
    // sorted ascending by raw-land $/ac
    expect(result!.comps[0].residualPricePerAcre).toBe(4_000);
  });

  it('acreage_band tier excludes improved when subject is bare', () => {
    const subject = stub({
      id: 's',
      acreage: 10,
      // Strip lat/lng so the nearby tier doesn't fire — this test
      // is specifically about whether tier-mismatched improved
      // listings get pulled into the acreage_band pool.
      location: { lat: 0, lng: 0, state: 'TX', county: 'Travis', address: '' },
    });
    const corpus = [
      // 3 same-acre bare_land (below 5 threshold for acreage_band)
      ...Array.from({ length: 3 }, (_, i) =>
        stub({
          id: `bare${i}`,
          acreage: 10,
          pricePerAcre: 4000,
          location: { lat: 0, lng: 0, state: 'TX', county: 'Travis', address: '' },
        }),
      ),
      // 4 same-acre IMPROVED — should be excluded from acreage_band
      // (different tier) but counted in the county fallback.
      ...Array.from({ length: 4 }, (_, i) =>
        stub({
          id: `imp${i}`,
          acreage: 10,
          pricePerAcre: 8000,
          residualPricePerAcre: 5000,
          improvements: { electric: true },
          location: { lat: 0, lng: 0, state: 'TX', county: 'Travis', address: '' },
        }),
      ),
    ];
    const result = findBestComps(subject, corpus);
    // 3 bare + 4 improved = 7 county total; both pools fail to clear
    // 5 in acreage_band (only 3 bare match) → falls through nearby
    // (no coords) → lands on county with 7 comps.
    expect(result?.pool).toBe('county');
    expect(result?.count).toBe(7);
  });

  it('falls through to county when nearby radius is empty', () => {
    const subject = stub({ id: 's', acreage: 10 });
    // 5 same-county but very different acreage AND no coords
    const corpus = Array.from({ length: 5 }, (_, i) =>
      stub({
        id: `c${i}`,
        acreage: 100 + i,
        pricePerAcre: 3000 + i * 100,
        // Coordinates outside 25mi so nearby pool is empty
        location: { lat: 0, lng: 0, state: 'TX', county: 'Travis', address: '' },
      }),
    );
    const result = findBestComps(subject, corpus);
    expect(result?.pool).toBe('county');
    expect(result?.count).toBe(5);
  });

  it('excludes the subject itself from its own comp pool', () => {
    const subject = stub({ id: 's', acreage: 10, pricePerAcre: 100_000 });
    const corpus = [subject, ...Array.from({ length: 6 }, (_, i) =>
      stub({ id: `c${i}`, acreage: 10, pricePerAcre: 5000 }),
    )];
    const result = findBestComps(subject, corpus);
    // Median should be 5000, not skewed toward the subject's 100k
    expect(result?.median).toBe(5000);
  });

  it('rawLandPpa prefers residual over asking', () => {
    expect(rawLandPpa(stub({ pricePerAcre: 10_000, residualPricePerAcre: 4_000 }))).toBe(4_000);
    expect(rawLandPpa(stub({ pricePerAcre: 10_000 }))).toBe(10_000);
    expect(rawLandPpa(stub({ pricePerAcre: 10_000, residualPricePerAcre: 0 }))).toBe(10_000);
  });

  it('excludes expired/pending listings from comps', () => {
    const subject = stub({ id: 's', acreage: 10 });
    const corpus = [
      ...Array.from({ length: 3 }, (_, i) =>
        stub({ id: `c${i}`, acreage: 10, pricePerAcre: 5000 }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        stub({ id: `exp${i}`, acreage: 10, pricePerAcre: 99999, status: 'expired' }),
      ),
    ];
    // Active count = 3, below threshold; nearby/county also under threshold.
    expect(findBestComps(subject, corpus)).toBeNull();
  });
});

describe('formatVsComp', () => {
  it('returns null when comp is null', () => {
    expect(formatVsComp(5000, null)).toBeNull();
  });

  it('uses scope-appropriate language per pool', () => {
    const acreageBand = {
      median: 10_000,
      count: 6,
      pool: 'acreage_band' as const,
      poolLabel: '6 nearby 5–15ac listings in Travis',
      comps: [],
    };
    expect(formatVsComp(8_000, acreageBand)).toBe('20% below similar lots');

    const nearby = {
      median: 10_000,
      count: 8,
      pool: 'nearby' as const,
      poolLabel: '8 listings within 25mi',
      comps: [],
    };
    expect(formatVsComp(12_000, nearby)).toBe('20% above nearby comps');

    const county = {
      median: 10_000,
      count: 12,
      pool: 'county' as const,
      poolLabel: '12 listings in Travis',
      comps: [],
    };
    expect(formatVsComp(10_000, county)).toBe('at county median');
  });
});
