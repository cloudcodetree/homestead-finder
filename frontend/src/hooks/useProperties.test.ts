import { describe, expect, it } from 'vitest';
import { dedupeListings } from './useProperties';
import { Property } from '../types/property';

const stub = (overrides: Partial<Property>): Property =>
  ({
    id: 'a',
    title: 'A',
    description: '',
    source: 'test',
    url: '',
    location: { lat: 0, lng: 0, state: 'MO', county: 'X', address: '' },
    price: 1,
    pricePerAcre: 1,
    acreage: 1,
    dealScore: 1,
    features: [],
    images: [],
    dateFound: '2026-01-01',
    status: 'unverified',
    ...overrides,
  }) as Property;

describe('dedupeListings', () => {
  it('returns the input unchanged when there are no duplicates', () => {
    const input = [stub({ id: 'a', url: 'https://x.com/1' }), stub({ id: 'b', url: 'https://x.com/2' })];
    const out = dedupeListings(input);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('collapses two rows sharing a URL, keeping the richer one', () => {
    const sparse = stub({ id: 'a', url: 'https://x.com/1', images: [], description: '' });
    const rich = stub({
      id: 'a_dupe',
      url: 'https://x.com/1',
      images: ['p1.jpg', 'p2.jpg'],
      description: 'A reasonably long description that should outweigh the bare row.',
    });
    const out = dedupeListings([sparse, rich]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a_dupe');
  });

  it('treats URL case + whitespace as the same listing', () => {
    const a = stub({ id: 'a', url: 'https://X.com/1 ' });
    const b = stub({ id: 'b', url: 'https://x.com/1' });
    expect(dedupeListings([a, b])).toHaveLength(1);
  });

  it('falls back to id when url is empty (preserves rows with no source URL)', () => {
    const a = stub({ id: 'tax_a', url: '' });
    const b = stub({ id: 'tax_b', url: '' });
    expect(dedupeListings([a, b])).toHaveLength(2);
  });

  it('drops rows without an id (defensive — should never happen in real data)', () => {
    const out = dedupeListings([stub({ id: '' as string }), stub({ id: 'a' })]);
    expect(out.map((p) => p.id)).toEqual(['a']);
  });

  it('prefers a row with valid coords over one with lat=lng=0', () => {
    const noCoords = stub({ id: 'a', url: 'https://x.com/1' });
    const geocoded = stub({
      id: 'a_geo',
      url: 'https://x.com/1',
      location: { lat: 38.5, lng: -91.2, state: 'MO', county: 'X', address: '' },
    });
    const out = dedupeListings([noCoords, geocoded]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a_geo');
  });

  it('prefers the row with an aiSummary among otherwise-equal pairs', () => {
    const plain = stub({ id: 'a', url: 'https://x.com/1' });
    const enriched = stub({
      id: 'a_enriched',
      url: 'https://x.com/1',
      aiSummary: 'Quiet 40-acre parcel with creek frontage.',
    });
    const out = dedupeListings([plain, enriched]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a_enriched');
  });
});
