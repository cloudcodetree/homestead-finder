import { Property } from '../types/property';

/**
 * Visual grouping of listings by transaction type. Informs the colored
 * accent stripe on PropertyCard + marker color on the Map + the small
 * badge next to the source name. Order of precedence:
 *
 *   1. tax-sale rows split by stateType (lien / deed / redeemable_deed
 *      / hybrid) — each has materially different diligence workflows,
 *      so they get distinct colors.
 *   2. for-sale rows split by owner-finance vs traditional listing.
 *      Owner-financed = HomesteadCrossing / OzarkLand / any row tagged
 *      with the `owner_financing` feature — the homestead buyer's
 *      path-of-least-resistance.
 *   3. fallback = "for sale" neutral.
 *
 * Colors chosen to be distinguishable at a glance, legible over the
 * hero thumbnail, and not to conflict with the deal-score badge colors
 * (green/yellow/orange/red). Tailwind palette names are named so the
 * bar + badge can share a single stylesheet entry per variant.
 */
export type ListingVariant =
  | 'for_sale_standard'
  | 'for_sale_owner_finance'
  | 'tax_sale_lien'
  | 'tax_sale_deed'
  | 'tax_sale_redeemable_deed'
  | 'tax_sale_hybrid';

interface ListingTypeStyle {
  variant: ListingVariant;
  label: string;
  /** Short tooltip explaining what the variant means. */
  description: string;
  /** Tailwind classes for the thin top-edge accent stripe. */
  accentBar: string;
  /** Tailwind classes for a small pill badge rendered near the source. */
  badgePill: string;
  /** Hex color for the Map marker dot (outside Tailwind's scope). */
  markerHex: string;
}

const STYLES: Record<ListingVariant, ListingTypeStyle> = {
  for_sale_standard: {
    variant: 'for_sale_standard',
    label: 'For Sale',
    description:
      'Standard listing via a brokerage marketplace. Typical financing, market-rate pricing.',
    accentBar: 'bg-slate-400',
    badgePill: 'bg-slate-100 text-slate-700 border-slate-200',
    markerHex: '#64748b',
  },
  for_sale_owner_finance: {
    variant: 'for_sale_owner_finance',
    label: 'Owner Finance',
    description:
      'Seller-carried financing — often no credit check, low down payment. The fastest homestead path.',
    accentBar: 'bg-emerald-500',
    badgePill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    markerHex: '#10b981',
  },
  tax_sale_lien: {
    variant: 'tax_sale_lien',
    label: 'Tax Lien',
    description:
      'Lien-state auction. You buy the lien certificate; prior owner has a redemption window to pay back with interest, else you may convert to deed.',
    accentBar: 'bg-amber-500',
    badgePill: 'bg-amber-50 text-amber-700 border-amber-200',
    markerHex: '#f59e0b',
  },
  tax_sale_deed: {
    variant: 'tax_sale_deed',
    label: 'Tax Deed',
    description:
      'Deed-state auction. Winning bidder takes the deed outright — no redemption period. Verify title thoroughly.',
    accentBar: 'bg-red-500',
    badgePill: 'bg-red-50 text-red-700 border-red-200',
    markerHex: '#ef4444',
  },
  tax_sale_redeemable_deed: {
    variant: 'tax_sale_redeemable_deed',
    label: 'Redeemable Deed',
    description:
      'Hybrid — buyer takes the deed with a short post-sale redemption window (e.g., 30 days in Arkansas) during which prior owner can redeem at a premium.',
    accentBar: 'bg-rose-500',
    badgePill: 'bg-rose-50 text-rose-700 border-rose-200',
    markerHex: '#f43f5e',
  },
  tax_sale_hybrid: {
    variant: 'tax_sale_hybrid',
    label: 'Tax Sale',
    description:
      'Hybrid state (e.g., Missouri). Early offerings behave like liens with a 1-year redemption; later offerings convert to deed.',
    accentBar: 'bg-purple-500',
    badgePill: 'bg-purple-50 text-purple-700 border-purple-200',
    markerHex: '#a855f7',
  },
};

export const getListingTypeStyle = (property: Property): ListingTypeStyle => {
  if (property.status === 'tax_sale' && property.taxSale) {
    switch (property.taxSale.stateType) {
      case 'lien':
        return STYLES.tax_sale_lien;
      case 'deed':
        return STYLES.tax_sale_deed;
      case 'redeemable_deed':
        return STYLES.tax_sale_redeemable_deed;
      case 'hybrid':
        return STYLES.tax_sale_hybrid;
      default:
        return STYLES.tax_sale_lien;
    }
  }
  // Owner-finance signal: either the source is a known owner-finance
  // specialist, or the scraper tagged the listing with the feature.
  const ownerFinance =
    property.source === 'homestead_crossing' ||
    property.source === 'ozarkland' ||
    property.features.includes('owner_financing');
  return ownerFinance ? STYLES.for_sale_owner_finance : STYLES.for_sale_standard;
};

/**
 * All variants in a stable order — used by the optional legend that
 * can be rendered above the filter panel.
 */
export const ALL_LISTING_VARIANTS: ListingTypeStyle[] = [
  STYLES.for_sale_standard,
  STYLES.for_sale_owner_finance,
  STYLES.tax_sale_lien,
  STYLES.tax_sale_deed,
  STYLES.tax_sale_redeemable_deed,
  STYLES.tax_sale_hybrid,
];
