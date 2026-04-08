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
  // TODO(user): Implement the filter predicate.
  // See the tests in web/__tests__/filters.test.ts for the exact semantics.
  // The function should use Array.prototype.filter with a single predicate
  // that checks every filter group (price, acreage, price-per-acre, score,
  // states, features, sources) and returns true only if ALL pass.
  return [];
}
