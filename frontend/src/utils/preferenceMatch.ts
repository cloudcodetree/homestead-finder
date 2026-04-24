import { Property } from '../types/property';
import { UserPreferences } from '../types/preferences';

/**
 * Scores how well a listing matches the user's stated preferences.
 * Returns a bonus in the range [0, 20] that gets added to the
 * dealScore during ranking. Additive rather than multiplicative so
 * a preference-matching listing never overtakes a genuinely
 * better-priced parcel by a huge margin — we want to NUDGE the sort,
 * not hijack it.
 *
 * Each matched dimension contributes a small, bounded bonus:
 *   - Budget fit (within range): +4
 *   - Acreage fit (≥ min): +3
 *   - Shopper mode match (move_in_ready / improved / bare): +4
 *   - State match (when user specified states): +2
 *   - Must-have features present (each): +2 up to +6
 *   - Driving tolerance met (when proximity data exists): +1
 *
 * Max bonus: ~20 points on a 100-point dealScore scale. Meaningful
 * but doesn't swallow the underlying deal quality.
 */
export const preferenceMatchScore = (
  p: Property,
  prefs: UserPreferences,
): number => {
  let bonus = 0;

  // Budget
  if (
    (prefs.budgetMinUsd == null || p.price >= prefs.budgetMinUsd) &&
    (prefs.budgetMaxUsd == null || p.price <= prefs.budgetMaxUsd) &&
    (prefs.budgetMinUsd != null || prefs.budgetMaxUsd != null)
  ) {
    bonus += 4;
  }

  // Acreage
  if (prefs.minAcreage != null && p.acreage >= prefs.minAcreage) {
    bonus += 3;
  }

  // Shopper mode
  if (prefs.shopperMode && prefs.shopperMode !== 'any') {
    const hasAny =
      !!p.improvements && Object.keys(p.improvements).length > 0;
    if (prefs.shopperMode === 'move_in_ready' && p.moveInReady) bonus += 4;
    else if (prefs.shopperMode === 'improved' && hasAny) bonus += 4;
    else if (prefs.shopperMode === 'bare_land' && !hasAny) bonus += 4;
  }

  // State match
  if (
    prefs.targetStates &&
    prefs.targetStates.length > 0 &&
    prefs.targetStates.includes(p.location.state)
  ) {
    bonus += 2;
  }

  // Must-have features
  if (prefs.mustHaveFeatures && prefs.mustHaveFeatures.length > 0) {
    const matched = prefs.mustHaveFeatures.filter((f) =>
      p.features.includes(f),
    ).length;
    bonus += Math.min(matched * 2, 6);
  }

  // Driving tolerance — only when we have proximity data
  if (
    prefs.drivingToleranceMin != null &&
    p.geoEnrichment?.proximity?.nearestTownDistanceMiles != null
  ) {
    // Rough conversion: 1 mile ≈ 1.5 min on Ozark back roads
    const estMin =
      p.geoEnrichment.proximity.nearestTownDistanceMiles * 1.5;
    if (estMin <= prefs.drivingToleranceMin) bonus += 1;
  }

  return bonus;
};
