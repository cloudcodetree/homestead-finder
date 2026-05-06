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

/**
 * OSM / Overpass-sourced "how remote is this really" signals. Nearest
 * populated town + a sample of water features within a few miles.
 * Rural US coverage in OSM is uneven; the absence of named water
 * features does NOT imply the absence of water — use SoilInfo.drainageClass
 * and WatershedInfo.watershedName as primary water signals.
 */
export interface ProximityInfo {
  /** Nearest OSM place tagged city/town/village within the search radius. */
  nearestTownName?: string;
  nearestTownDistanceMiles?: number;
  nearestTownPopulation?: number;
  nearestTownKind?: string;
  searchRadiusMiles?: number;
  /** Count of OSM-tagged water features within the water search radius. */
  waterFeatureCount?: number;
  /** Sample of named water features nearby (creeks, rivers, ponds, lakes). */
  namedWaterFeatures?: string[];
}

export interface GeoEnrichment {
  lat: number;
  lng: number;
  soil?: SoilInfo | null;
  flood?: FloodInfo | null;
  elevation?: ElevationInfo | null;
  watershed?: WatershedInfo | null;
  proximity?: ProximityInfo | null;
  fetchedAt?: string;
}

/**
 * County-level political-lean signal. Sourced from publicly-available
 * presidential election returns (MIT Election Lab is the typical
 * canonical source). Stamped onto each listing by
 * `scraper/enrichment/voting.py` based on the listing's
 * (state, county) pair.
 *
 * The signal is County-level, not parcel-level — it reflects the
 * surrounding electorate, not the listing itself. UI surfaces it
 * as a "what are the neighbors like" indicator inside the Lifestyle
 * Fit family of signals.
 */
export interface VotingPattern {
  /** Election year the signal is from (e.g. 2024). */
  year: number;
  /** Democratic vote share, 0–100. */
  dPct: number;
  /** Republican vote share, 0–100. */
  rPct: number;
  /** Margin in percentage points; positive = R-leaning, negative = D-leaning. */
  marginPp: number;
  /**
   * Coarse bucket consumers can filter on:
   *   strongly_d: D won by ≥20pp
   *   lean_d:    D won by 5–20pp
   *   balanced:  margin within ±5pp
   *   lean_r:    R won by 5–20pp
   *   strongly_r: R won by ≥20pp
   * Computed once at enrichment time so the frontend doesn't have
   * to re-derive from rPct/dPct on every render.
   */
  bucket: 'strongly_d' | 'lean_d' | 'balanced' | 'lean_r' | 'strongly_r';
}

/**
 * One contributing signal feeding an InvestmentScore axis. The frontend
 * renders the axis bar; signals are surfaced in a tooltip / expander
 * so the user can see what the model actually looked at.
 */
export interface InvestmentSignal {
  label: string;
  /** Relative weight inside its axis (0-1). 0 = informational only. */
  weight: number;
  /** Signal value as the user should see it — string or number. */
  value: string | number | null;
}

/**
 * One axis of the InvestmentScore composite. Returned as an ordered
 * LIST (not a dict) by `compute_investment_score` so axis reordering /
 * reweighting is a one-line state change in the future.
 */
export type InvestmentAxisKey =
  | 'value'
  | 'land'
  | 'risk'
  | 'liquidity'
  | 'macro';

export interface InvestmentAxis {
  key: InvestmentAxisKey;
  label: string;
  /** 0-100 score for this axis. */
  score: number;
  /** Composite weight applied to this axis (0-1). 0 = axis disabled
   * for this listing because the underlying data isn't ingested yet. */
  weight: number;
  /** Optional contributing signals — present only when the score was
   * computed live in the browser. The persisted form on disk drops
   * `signals` to keep listings.json small (each one was ~600 bytes).
   * The detail panel still renders bars + scores fine without them;
   * the per-axis ⓘ expander just hides until signals are available. */
  signals?: InvestmentSignal[];
}

export interface InvestmentBreakdown {
  /** 0-100 composite — same value as Property.investmentScore. */
  score: number;
  axes: InvestmentAxis[];
  /** Optional — only present on live-computed breakdowns. The
   * persisted form skips this to save bytes. */
  computedAt?: string;
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
  /** Transaction type at auction:
   *   - 'lien': certificate auction + redemption period (WY, MT)
   *   - 'deed': title auction, no redemption (WA, TX)
   *   - 'redeemable_deed': title auction + short post-sale redemption
   *     window (AR 30-day, TN 1-yr, GA 1-yr)
   *   - 'hybrid': mixed — early offerings lien-like, later convert to
   *     deed (MO Collector's 1st/2nd/3rd offerings)
   */
  stateType?: 'lien' | 'deed' | 'redeemable_deed' | 'hybrid';
  state?: string;
  county?: string;
  listUrl?: string;
  // ── Analytics (populated by scraper/sources/tax_sale_analytics.py) ──
  /** 'acreage' = explicit AC in legal desc, 'rural' = PLSS only,
   *  'town_lot' = lot/block, 'unknown' otherwise. */
  parcelType?: 'acreage' | 'rural' | 'town_lot' | 'unknown';
  estimatedAcres?: number | null;
  /** acres × county median $/acre from our LandWatch corpus. */
  estimatedValueUsd?: number | null;
  /** Deed states only. Conservative: (estValue - minBid - $5k costs) / minBid. */
  investmentMultiple?: number | null;
  /** Lien states only. Annualized % return, weighted for redemption probability. */
  expectedReturnPct?: number | null;
  /** Human-readable reasons surfaced behind the analytics numbers. */
  analyticsNotes?: string[];
  // ── Bid4Assets sale-announcement rows only (no per-parcel data) ──
  isSaleAnnouncement?: boolean;
  lotCount?: number | null;
  depositUsd?: number | null;
  premiumPct?: number | null;
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
  /**
   * Legacy single-image field (pre-gallery). Kept for any rows that
   * still carry just a primary thumbnail; new scrapes populate
   * `images[]` instead. Frontend thumbnail component falls through
   * this when `images[]` is absent.
   */
  imageUrl?: string;
  /**
   * Ordered list of image URLs as captured by the source scraper
   * (search-card thumb first, then gallery). Rendered via the
   * images.weserv.nl proxy so hotlink-blocking CDNs (LandWatch,
   * Land.com) don't break the UI. Empty array / omitted = show the
   * placeholder.
   */
  images?: string[];
  validated?: boolean;
  validatedAt?: string;
  status?: 'active' | 'expired' | 'pending' | 'unverified' | 'tax_sale';
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

  /**
   * County-level political lean. Stamped by scraper/enrichment/voting.py
   * from a vendored election-results JSON. Optional because older rows
   * predate the enrichment + counties without a match (rural Alaska,
   * unincorporated territories) won't have one.
   */
  votingPattern?: VotingPattern;

  /**
   * Self-Sufficiency composite + per-axis breakdown. Pre-computed at
   * scrape time by `scraper/shard_listings.py` and stamped onto the
   * slim index so PropertyCard can render the SS ring + 5 axis bars
   * without shipping the full `geoEnrichment` subtree through the
   * Browse fetch. The detail page recomputes the full report
   * (including gaps + verdicts) client-side from the per-id full
   * record. Optional because rows scraped before this field was
   * introduced won't have it; in that case the frontend falls back to
   * `computeSelfSufficiency(p)` from utils/selfSufficiency.ts.
   */
  selfSufficiency?: {
    composite: number;
    axes: Array<{
      key: 'food' | 'water' | 'energy' | 'shelter' | 'resilience';
      score: number;
      weight: number;
    }>;
  };
  /**
   * Composite 0-100 InvestmentScore. Stamped by scraper/investment_score.py.
   * Sortable + headline number for the property-as-stock view.
   */
  investmentScore?: number;
  /**
   * Per-axis breakdown of `investmentScore` so the frontend can render
   * a transparent visualization (horizontal bars / radar) instead of
   * a black-box number. Axes are returned as an ordered LIST so user
   * reordering / reweighting is a one-line state change later.
   */
  investmentBreakdown?: InvestmentBreakdown;

  // ── Structures / improvements (scraper/improvements.py) ─────────
  /**
   * Flags keyed by improvement type when detected in the title+description.
   * Keys: home, cabin, barn, outbuilding, well, septic, electric, water_city.
   * Each value is always `true`; absent keys = not detected (vs. "confirmed
   * absent"). Value-conservative: we'd rather UNDER-credit a seller than
   * inflate a residual land price.
   */
  improvements?: Record<string, boolean>;
  /** Sum of conservative per-improvement values in USD. */
  estimatedStructureValueUsd?: number;
  /** Asking price minus estimated structure value, floored at 10% of asking.
   * Used to compute a fair $/acre comparison for improved vs. bare land.
   * A cabin-on-40ac for $250k with $65k of structures has residualLandPrice
   * $185k → $4,625/ac residual (vs. the raw $6,250/ac), which is how this
   * listing should be deal-scored against a bare-land comp. */
  residualLandPrice?: number;
  residualPricePerAcre?: number;
  /**
   * True when the listing has a primary dwelling (home OR cabin) AND a
   * water source (well OR city water). Septic is inferred — 99% of
   * occupied rural homes have it even when the listing doesn't say so.
   */
  moveInReady?: boolean;
  /**
   * Rough estimate of what a buyer would need to spend to bring this
   * parcel to move-in-ready from its current state. Zero when already
   * move-in-ready. Feeds the Total-Cost-to-Homestead view. Assumes a
   * modest cabin/modular build, basic well+septic, solar if off-grid.
   */
  estimatedBuildoutUsd?: number;
}

export type SortBy =
  | 'selfSufficiency'
  | 'dealScore'
  | 'investmentScore'
  | 'homesteadFit'
  | 'recommended'
  | 'priceAsc'
  | 'priceDesc'
  | 'pricePerAcre'
  | 'residualPricePerAcre'
  | 'acreage'
  | 'dateFound'
  | 'title';

export const SORT_LABELS: Record<SortBy, string> = {
  selfSufficiency: 'Self-Sufficiency',
  dealScore: 'Best Deal',
  investmentScore: 'Investment Score (AI)',
  homesteadFit: 'Homestead Fit (AI)',
  // Only visible when the user has enough save history for a fitted
  // model (see useRankingWeights.hasEnoughData). The Dashboard filters
  // this option out of the sort dropdown otherwise.
  recommended: 'Recommended for you',
  priceAsc: 'Price: Low to High',
  priceDesc: 'Price: High to Low',
  pricePerAcre: 'Price / Acre',
  // Price-per-acre AFTER subtracting estimated structure value — fair
  // comparison between improved and bare land. A cabin-on-40-acres
  // listing doesn't look artificially overpriced under this sort.
  residualPricePerAcre: 'Land $/Acre (structures-adjusted)',
  acreage: 'Acreage',
  dateFound: 'Newest',
  title: 'Name',
};

export interface FilterState {
  minPrice: number;
  maxPrice: number;
  minAcreage: number;
  maxAcreage: number;
  minPricePerAcre: number;
  /** Upper bound on $/acre. 1,000,000 = "no cap" (slider tops out at $1M+). */
  maxPricePerAcre: number;
  states: string[];
  features: PropertyFeature[];
  minDealScore: number;
  sources: string[];
  /** Listing-type filter (e.g. "tax_sale_redeemable_deed",
   * "for_sale_owner_finance"). Empty array = no filter. Variants are
   * derived per-row by `getListingTypeStyle` in utils/listingType.ts. */
  listingVariants: string[];
  sortBy: SortBy;
  // Self-Sufficiency — the autonomy-first composite + per-axis
  // minimums. Composite is a 0-100 weighted average of five axes;
  // per-axis fields let users gate on a specific dimension
  // ("must score ≥ 70 on Water") without bringing along the whole
  // composite.
  minSelfSufficiency: number;
  minSsFood: number;
  minSsWater: number;
  minSsEnergy: number;
  minSsShelter: number;
  minSsResilience: number;
  // AI-derived filters (all optional — default behavior is no filtering)
  aiTags: AITag[];
  minHomesteadFit: number;
  /** Score-range upper bound. 100 = "no cap" (standard slider extreme). */
  maxHomesteadFit: number;
  minInvestmentScore: number;
  maxInvestmentScore: number;
  /** Upper bound for dealScore. The lower bound is `minDealScore`. */
  maxDealScore: number;
  hideWithRedFlags: boolean;
  /** Hide listings whose source marked them sold / pending / under
   * contract. Default true so the List view stays focused on things
   * a buyer could actually pursue. */
  hideInactive: boolean;
  /** Free-text query, case-insensitive substring match across title,
   * description, county, features, improvements. Empty string = no
   * filter. Saved as part of a saved search so a user can pin
   * "anything mentioning 'spring' in Howell County" as a project
   * watchlist. */
  searchText: string;
  /**
   * Improvement tier filter. 'any' = no filter. 'move_in_ready' = only
   * listings with dwelling + water. 'improved' = any detected
   * structure or utility. 'bare_land' = nothing detected. Matches the
   * buyer's real decision: am I buying to move in now, or to build?
   */
  improvementTier: 'any' | 'move_in_ready' | 'improved' | 'bare_land';
  /**
   * Optional drawn search polygon. When set, listings are filtered to
   * those whose lat/lng falls inside this polygon. Each entry is a
   * `[lat, lng]` pair; the polygon is implicitly closed (first vertex
   * connects to last). Drawn from MapView via "Draw area"; persisted
   * here so the polygon survives view-mode switches and is part of a
   * saveable search.
   */
  drawnArea: Array<[number, number]> | null;
}

export const DEFAULT_FILTERS: FilterState = {
  // 2026-04-29: every range filter defaults to "no min / no max" so
  // a fresh session shows the full corpus without the user having to
  // know what knob is hiding things. `0` is the sentinel for
  // "unbounded" on every range field — useProperties.applyFilters
  // skips the comparison when either side is <= 0. The FilterPanel
  // inputs accept 0 / empty to mean "off" too.
  minPrice: 0,
  // Slider-bound sentinel: 250,000 (the slider's top stop) means
  // "no cap". applyFilters skips the comparison at that value.
  maxPrice: 250_000,
  minAcreage: 0,
  // Slider-bound sentinel: 100 (the slider's top stop) means "no cap".
  // applyFilters skips the comparison at that value.
  maxAcreage: 100,
  minPricePerAcre: 0,
  // Slider-bound sentinel: 10,000 (the slider's top stop) means
  // "no cap". applyFilters skips the comparison at that value.
  maxPricePerAcre: 10_000,
  states: [],
  features: [],
  minDealScore: 0,
  sources: [],
  listingVariants: [],
  // Default sort: Self-Sufficiency descending. Autonomy-first framing
  // is the product's North Star — leading with the parcels that
  // require the least buildout to reach off-grid steady state.
  // Changed from 'priceAsc' on 2026-05-06.
  sortBy: 'selfSufficiency',
  // Self-Sufficiency filters — all default to 0 ("no minimum").
  minSelfSufficiency: 0,
  minSsFood: 0,
  minSsWater: 0,
  minSsEnergy: 0,
  minSsShelter: 0,
  minSsResilience: 0,
  aiTags: [],
  minHomesteadFit: 0,
  maxHomesteadFit: 100,
  minInvestmentScore: 0,
  maxInvestmentScore: 100,
  maxDealScore: 100,
  hideWithRedFlags: false,
  hideInactive: true,
  improvementTier: 'any',
  searchText: '',
  drawnArea: null,
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

/**
 * Produced by scraper/deals.py. Same pick shape as CurationResult but
 * with additional funnel metadata (how many listings survived the
 * homestead-specific hard filters) and the filter summary itself so the
 * UI can explain the rationale.
 */
export interface HomesteadDealsResult {
  generatedAt: string;
  model: string;
  totalListings: number;
  passedFiltersCount: number;
  candidateCount: number;
  pickCount: number;
  filterSummary: {
    minAcres: number;
    maxPriceUsd: number;
    criticalRedFlagsExcluded: string[];
    sfhaZonesExcluded: string[];
    maxSoilCapabilityClass: number;
  };
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
