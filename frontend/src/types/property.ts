// AI vocabulary types (AITag, RedFlag, labels, severities) are generated
// from scraper/ai_vocab.json by scraper/emit_ts_vocab.py — re-exported here
// so existing imports from './property' keep working.
import type { AITag, RedFlag } from './ai-vocab.generated';
export {
  AI_TAG_KEYS,
  AI_TAG_LABELS,
  AI_TAG_DESCRIPTIONS,
  RED_FLAG_KEYS,
  RED_FLAG_LABELS,
  RED_FLAG_DESCRIPTIONS,
  RED_FLAG_SEVERITY,
} from './ai-vocab.generated';
export type { AITag, RedFlag };

export interface PropertyLocation {
  lat: number;
  lng: number;
  state: string;
  county: string;
  address?: string;
}

export type PropertyFeature =
  | 'water_well'
  | 'water_creek'
  | 'water_pond'
  | 'road_paved'
  | 'road_dirt'
  | 'electric'
  | 'septic'
  | 'structures'
  | 'timber'
  | 'pasture'
  | 'hunting'
  | 'mineral_rights'
  | 'no_hoa'
  | 'off_grid_ready'
  | 'owner_financing';

/**
 * Soil map-unit info from USDA SSURGO (via scraper/enrichment/soil.py).
 * Fields are optional because older listings may have been enriched
 * before a given field was added.
 */
export interface SoilInfo {
  mapUnitKey?: string;
  mapUnitName?: string;
  /** e.g. "Prime farmland", "Farmland of statewide importance" */
  farmlandClass?: string;
  /** Non-irrigated capability class: "1" (best) through "8" (worst). */
  capabilityClass?: string;
  /** Human-readable class description (e.g. "Prime cropland, few limitations"). */
  capabilityClassDescription?: string;
  capabilityClassPercent?: number;
  slopePercent?: number;
  drainageClass?: string;
  floodFrequency?: string;
  hydrologicGroup?: string;
  bedrockDepthInches?: number | null;
  waterTableDepthInches?: number | null;
}

export interface FloodInfo {
  /** FEMA zone code: A/AE/AH/AO/V/VE = 100-yr floodplain; X = outside; D = unstudied. */
  floodZone?: string;
  isSFHA?: boolean;
  baseFloodElevation?: number | null;
}

export interface ElevationInfo {
  elevationMeters?: number;
  elevationFeet?: number;
}

export interface WatershedInfo {
  /** 12-digit Hydrologic Unit Code. */
  huc12?: string;
  watershedName?: string;
  areaAcres?: number | null;
  states?: string;
}

export interface GeoEnrichment {
  lat: number;
  lng: number;
  soil?: SoilInfo | null;
  flood?: FloodInfo | null;
  elevation?: ElevationInfo | null;
  watershed?: WatershedInfo | null;
  fetchedAt?: string;
}

/**
 * URLs to third-party parcel research tools that LandWatch links out to.
 * We don't scrape these (ToS prohibits), but we surface the deep links
 * so users can click through for richer research.
 */
export interface ExternalResearchLinks {
  acreValue?: string;
  landId?: string;
  firstStreet?: string;
  coStar?: string;
}

/**
 * Delinquent county tax-sale data. Populated by scraper/sources/county_tax.py
 * for listings where the "for sale" is actually a tax-lien certificate
 * auction (in lien states like WY) or tax-deed auction (in deed states).
 * These listings have `status === 'tax_sale'`.
 */
export interface TaxSale {
  owner: string;
  parcelId: string;
  taxDistrict?: string;
  legalDescription?: string;
  houseNumber?: string;
  street?: string;
  /** County-specific property-type code (e.g. RE = real estate, IR = other). */
  propertyType?: string;
  taxYear?: number;
  /** The minimum bid — exactly what's owed for taxes + penalty + interest. */
  amountOwedUsd: number;
  /** Typical month the in-person sale is held (1-12). */
  saleMonth?: number | null;
  /** 'lien' = certificate auction (WY, MT), 'deed' = title auction (WA, TX). */
  stateType?: 'lien' | 'deed';
  listUrl?: string;
}

export interface Property {
  id: string;
  title: string;
  price: number;
  acreage: number;
  pricePerAcre: number;
  location: PropertyLocation;
  features: PropertyFeature[];
  source: string;
  url: string;
  dateFound: string;
  dealScore: number;
  description?: string;
  daysOnMarket?: number;
  imageUrl?: string;
  validated?: boolean;
  validatedAt?: string;
  status?: 'active' | 'expired' | 'unverified' | 'tax_sale';
  /** Populated when status === 'tax_sale'. */
  taxSale?: TaxSale;
  // AI enrichment (added by scraper/enrich.py — optional because not every
  // listing may be enriched yet)
  aiTags?: AITag[];
  homesteadFitScore?: number;
  redFlags?: RedFlag[];
  aiSummary?: string;
  enrichedAt?: string;
  // Detail-page enrichment (added by scraper/detail_fetcher.py) — lat/lng
  // is merged into `location`, these fields carry the rest.
  detailFetchedAt?: string;
  externalLinks?: ExternalResearchLinks;
  // Geospatial enrichment (added by scraper/enrich_geo.py) — soil, flood,
  // elevation, watershed pulled from free US government APIs.
  geoEnrichment?: GeoEnrichment;
}

export type SortBy =
  | 'dealScore'
  | 'homesteadFit'
  | 'priceAsc'
  | 'priceDesc'
  | 'pricePerAcre'
  | 'acreage'
  | 'dateFound'
  | 'title';

export const SORT_LABELS: Record<SortBy, string> = {
  dealScore: 'Best Deal',
  homesteadFit: 'Homestead Fit (AI)',
  priceAsc: 'Price: Low to High',
  priceDesc: 'Price: High to Low',
  pricePerAcre: 'Price / Acre',
  acreage: 'Acreage',
  dateFound: 'Newest',
  title: 'Name',
};

export interface FilterState {
  minPrice: number;
  maxPrice: number;
  minAcreage: number;
  maxAcreage: number;
  maxPricePerAcre: number;
  states: string[];
  features: PropertyFeature[];
  minDealScore: number;
  sources: string[];
  sortBy: SortBy;
  // AI-derived filters (all optional — default behavior is no filtering)
  aiTags: AITag[];
  minHomesteadFit: number;
  hideWithRedFlags: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  minPrice: 0,
  maxPrice: 2_000_000,
  minAcreage: 0,
  maxAcreage: 10_000,
  maxPricePerAcre: 10_000,
  states: [],
  features: [],
  minDealScore: 0,
  sources: [],
  sortBy: 'dealScore',
  aiTags: [],
  minHomesteadFit: 0,
  hideWithRedFlags: false,
};

export const FEATURE_LABELS: Record<PropertyFeature, string> = {
  water_well: 'Water Well',
  water_creek: 'Creek/Stream',
  water_pond: 'Pond/Lake',
  road_paved: 'Paved Road',
  road_dirt: 'Dirt Road',
  electric: 'Electric',
  septic: 'Septic',
  structures: 'Structures',
  timber: 'Timber',
  pasture: 'Pasture',
  hunting: 'Hunting',
  mineral_rights: 'Mineral Rights',
  no_hoa: 'No HOA',
  off_grid_ready: 'Off-Grid Ready',
  owner_financing: 'Owner Financing',
};

export interface CuratedPick {
  id: string;
  rank: number;
  headline: string;
  reason: string;
}

export interface CurationResult {
  curatedAt: string;
  model: string;
  candidateCount: number;
  pickCount: number;
  picks: CuratedPick[];
}

export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};
