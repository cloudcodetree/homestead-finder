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

// Tags produced by the local AI enrichment pass (scraper/enrich.py).
// Must stay in sync with AI_TAG_VOCABULARY in scraper/enrich.py.
export type AITag =
  | 'paved_access'
  | 'seasonal_access_only'
  | 'remote_access_concerns'
  | 'utilities_on_site'
  | 'off_grid_viable'
  | 'infrastructure_needed'
  | 'water_rights_present'
  | 'year_round_water'
  | 'seasonal_water_only'
  | 'no_water_mentioned'
  | 'build_ready'
  | 'buildable_with_work'
  | 'difficult_terrain'
  | 'soil_suitable_for_ag'
  | 'remote_living_viable'
  | 'near_services'
  | 'isolated'
  | 'agricultural_potential'
  | 'timber_harvestable'
  | 'hunting_viable'
  | 'grazing_suitable'
  | 'no_hoa'
  | 'hoa_present'
  | 'deed_restrictions'
  | 'zoning_concerns'
  | 'flood_risk_mentioned'
  | 'fire_risk_mentioned'
  | 'mineral_rights_excluded';

// Must stay in sync with AI_RED_FLAG_VOCABULARY in scraper/enrich.py.
export type RedFlag =
  | 'hoa_restrictions'
  | 'flood_zone_mention'
  | 'wetland_restrictions'
  | 'no_water_source'
  | 'no_road_access'
  | 'easement_concerns'
  | 'environmental_hazard'
  | 'title_issues_mentioned'
  | 'tax_sale_risk'
  | 'requires_septic_install'
  | 'requires_well_drilling'
  | 'zoning_prohibits_residential'
  | 'extreme_remote'
  | 'price_seems_too_good';

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
  status?: 'active' | 'expired' | 'unverified';
  // AI enrichment (added by scraper/enrich.py — optional because not every
  // listing may be enriched yet)
  aiTags?: AITag[];
  homesteadFitScore?: number;
  redFlags?: RedFlag[];
  aiSummary?: string;
  enrichedAt?: string;
}

export type SortBy =
  | 'dealScore'
  | 'homesteadFit'
  | 'price'
  | 'pricePerAcre'
  | 'acreage'
  | 'dateFound'
  | 'title';

export const SORT_LABELS: Record<SortBy, string> = {
  dealScore: 'Best Deal',
  homesteadFit: 'Homestead Fit (AI)',
  price: 'Price',
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

export const AI_TAG_LABELS: Record<AITag, string> = {
  paved_access: 'Paved Access',
  seasonal_access_only: 'Seasonal Access',
  remote_access_concerns: 'Remote Access',
  utilities_on_site: 'Utilities On-Site',
  off_grid_viable: 'Off-Grid Viable',
  infrastructure_needed: 'Infrastructure Needed',
  water_rights_present: 'Water Rights',
  year_round_water: 'Year-Round Water',
  seasonal_water_only: 'Seasonal Water',
  no_water_mentioned: 'No Water Mentioned',
  build_ready: 'Build-Ready',
  buildable_with_work: 'Buildable w/ Work',
  difficult_terrain: 'Difficult Terrain',
  soil_suitable_for_ag: 'Good Ag Soil',
  remote_living_viable: 'Remote Living',
  near_services: 'Near Services',
  isolated: 'Isolated',
  agricultural_potential: 'Agriculture',
  timber_harvestable: 'Timber',
  hunting_viable: 'Hunting',
  grazing_suitable: 'Grazing',
  no_hoa: 'No HOA',
  hoa_present: 'HOA Present',
  deed_restrictions: 'Deed Restrictions',
  zoning_concerns: 'Zoning Issues',
  flood_risk_mentioned: 'Flood Risk',
  fire_risk_mentioned: 'Fire Risk',
  mineral_rights_excluded: 'Mineral Rights Excluded',
};

export const RED_FLAG_LABELS: Record<RedFlag, string> = {
  hoa_restrictions: 'HOA Restrictions',
  flood_zone_mention: 'Flood Zone',
  wetland_restrictions: 'Wetland',
  no_water_source: 'No Water Source',
  no_road_access: 'No Road Access',
  easement_concerns: 'Easement Concerns',
  environmental_hazard: 'Environmental Hazard',
  title_issues_mentioned: 'Title Issues',
  tax_sale_risk: 'Tax Sale Risk',
  requires_septic_install: 'Needs Septic',
  requires_well_drilling: 'Needs Well',
  zoning_prohibits_residential: 'Zoning: No Residential',
  extreme_remote: 'Extremely Remote',
  price_seems_too_good: 'Price Too Good',
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
