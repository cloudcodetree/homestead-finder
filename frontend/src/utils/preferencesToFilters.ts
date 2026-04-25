import { DEFAULT_FILTERS, FilterState } from '../types/property';
import { UserPreferences } from '../types/preferences';

/**
 * Map a user's saved preferences onto a partial FilterState so the
 * dashboard can seed their first-session filters from what they told
 * us during onboarding.
 *
 * Only populates fields the user actually answered — a null/empty
 * preference leaves the default filter alone. This is critical
 * because overwriting a user's active filter with stale preferences
 * on every re-render would break the basic expectation that filter
 * edits persist for the session.
 */
export const preferencesToFilters = (
  prefs: UserPreferences,
): Partial<FilterState> => {
  const patch: Partial<FilterState> = {};

  if (typeof prefs.budgetMinUsd === 'number' && prefs.budgetMinUsd > 0) {
    patch.minPrice = prefs.budgetMinUsd;
  }
  if (typeof prefs.budgetMaxUsd === 'number' && prefs.budgetMaxUsd > 0) {
    patch.maxPrice = prefs.budgetMaxUsd;
  }
  if (typeof prefs.minAcreage === 'number' && prefs.minAcreage > 0) {
    patch.minAcreage = prefs.minAcreage;
  }
  if (prefs.shopperMode && prefs.shopperMode !== 'any') {
    patch.improvementTier = prefs.shopperMode;
  }
  if (prefs.targetStates && prefs.targetStates.length > 0) {
    patch.states = prefs.targetStates;
  }
  if (prefs.mustHaveFeatures && prefs.mustHaveFeatures.length > 0) {
    patch.features = prefs.mustHaveFeatures;
  }

  return patch;
};

/**
 * True iff the given filter state is the app-wide default
 * (i.e. the user hasn't manually tweaked anything yet). Used to
 * decide whether it's SAFE to auto-apply preferences — we never
 * overwrite an active user edit.
 */
export const isDefaultFilters = (filters: FilterState): boolean => {
  return (
    filters.minPrice === DEFAULT_FILTERS.minPrice &&
    filters.maxPrice === DEFAULT_FILTERS.maxPrice &&
    filters.minAcreage === DEFAULT_FILTERS.minAcreage &&
    filters.maxAcreage === DEFAULT_FILTERS.maxAcreage &&
    filters.maxPricePerAcre === DEFAULT_FILTERS.maxPricePerAcre &&
    filters.states.length === 0 &&
    filters.features.length === 0 &&
    filters.aiTags.length === 0 &&
    filters.sources.length === 0 &&
    filters.listingVariants.length === 0 &&
    filters.minDealScore === 0 &&
    filters.minHomesteadFit === 0 &&
    filters.improvementTier === 'any' &&
    filters.hideWithRedFlags === DEFAULT_FILTERS.hideWithRedFlags &&
    filters.searchText === ''
  );
};
