import type { Property } from '@/types/property';

// Minimal sample fallback used when data/listings.json is empty or missing.
// Real samples are in frontend/src/data/sample-listings.json for the legacy app.
export const SAMPLE_LISTINGS: Property[] = [
  {
    id: 'sample_1',
    title: '40 Acres — Madison County, MT',
    price: 65_000,
    acreage: 40,
    pricePerAcre: 1625,
    location: { lat: 45.84, lng: -111.5, state: 'MT', county: 'Madison' },
    features: ['water_creek', 'timber', 'hunting', 'off_grid_ready'],
    source: 'landwatch',
    url: 'https://example.com/sample-1',
    dateFound: new Date().toISOString().slice(0, 10),
    dealScore: 78,
    description: 'Sample listing for development. Real data will appear here once the scraper runs.',
    status: 'unverified',
  },
  {
    id: 'sample_2',
    title: '15 Acres — Klamath County, OR',
    price: 28_500,
    acreage: 15,
    pricePerAcre: 1900,
    location: { lat: 42.22, lng: -121.78, state: 'OR', county: 'Klamath' },
    features: ['water_well', 'pasture', 'electric'],
    source: 'county_tax',
    url: 'https://example.com/sample-2',
    dateFound: new Date().toISOString().slice(0, 10),
    dealScore: 72,
    description: 'Sample listing for development. Real data will appear here once the scraper runs.',
    status: 'unverified',
  },
];
