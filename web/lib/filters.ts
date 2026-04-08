import type { Property, FilterState } from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';

// Re-export for convenience
export const DEFAULT_FILTERS_STATE = DEFAULT_FILTERS;

/**
 * Apply a FilterState to a list of properties and return the matches.
 *
 * Filter semantics:
 * - price / acreage / pricePerAcre / dealScore → numeric range checks
 * - states → OR match (listing in ANY selected state)
 * - features → AND match (listing must have ALL selected features)
 * - sources → OR match (listing from ANY selected source)
 * - All filter groups combine with AND (listing must pass every group)
 */
export function applyFilters(
  properties: Property[],
  filters: FilterState,
): Property[] {
  return properties.filter((p) => {
    // Numeric range checks — all inclusive bounds
    if (p.price < filters.minPrice || p.price > filters.maxPrice) return false;
    if (p.acreage < filters.minAcreage || p.acreage > filters.maxAcreage) return false;
    if (p.pricePerAcre > filters.maxPricePerAcre) return false;
    if (p.dealScore < filters.minDealScore) return false;

    // States — OR match. Empty array means "no state filter, show all".
    if (filters.states.length > 0 && !filters.states.includes(p.location.state)) {
      return false;
    }

    // Features — AND match. Listing must have EVERY selected feature.
    // Empty array means "no feature filter, show all".
    if (
      filters.features.length > 0 &&
      !filters.features.every((f) => p.features.includes(f))
    ) {
      return false;
    }

    // Sources — OR match. Empty array means "no source filter, show all".
    if (filters.sources.length > 0 && !filters.sources.includes(p.source)) {
      return false;
    }

    return true;
  });
}
