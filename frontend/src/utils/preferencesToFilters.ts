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

  // 2026-04-29: budget + acreage no longer seed from preferences.
  // After the Austin TX pivot, users with old MO/AR-era budgets
  // (e.g. $50k max) saw an empty page on first visit because their
  // prefs over-constrained the new corpus. The product principle is
  // "no min/no max by default" — let users set budget + acreage
  // explicitly per session via the FilterPanel. We still seed the
  // soft-preference dimensions (states, features, shopperMode)
  // because those don't silently zero a corpus.
  void prefs.budgetMinUsd;
  void prefs.budgetMaxUsd;
  void prefs.minAcreage;
  if (prefs.shopperMode && prefs.shopperMode !== 'any') {
    patch.improvementTier = prefs.shopperMode;
  }
  if (prefs.targetStates && prefs.targetStates.length > 0) {
    // `targetStates` may carry either bare state codes (`'MO'`,
    // `'AR'`) from older onboarding rows OR `<STATE>|<county>`
    // codes (`'TX|travis'`) from the post-2026-04-29 county-level
    // onboarding. The Browse filter operates on `location.state`
    // (state-level), so we collapse anything compound back to its
    // state segment and dedupe — without this, county-level codes
    // are passed through as-is, no listing matches, and the page
    // flashes the corpus then empties.
    const states = Array.from(
      new Set(
        prefs.targetStates
          .map((code) => (code.includes('|') ? code.split('|')[0] : code))
          .filter(Boolean),
      ),
    );
    if (states.length > 0) patch.states = states;
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
