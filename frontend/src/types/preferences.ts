import { PropertyFeature } from './property';

/**
 * Explicit user preferences captured during onboarding.
 *
 * Separate from the fitted personalization model (user_ranking_weights)
 * which is LEARNED from save/hide events. Preferences are what the
 * user TELLS us they want — used as a cold-start prior in ranking and
 * as default filter values on first session.
 *
 * Schema is deliberately additive + nullable — users skip questions,
 * onboarding is not a wall. Every field is optional so we can evolve
 * the survey without breaking older rows.
 */
export interface UserPreferences {
  /** Purchase price range in USD. Defaults to null/null = any. */
  budgetMinUsd?: number | null;
  budgetMaxUsd?: number | null;

  /** Minimum acreage; skip = any */
  minAcreage?: number | null;

  /** What the buyer is shopping for right now. Maps onto the
   * FilterState.improvementTier set so first-session default matches. */
  shopperMode?: 'move_in_ready' | 'improved' | 'bare_land' | 'any';

  /** Must-have features — listing is ranked lower if missing, not
   * filtered out. Allows hard filters later if the user tightens up. */
  mustHaveFeatures?: PropertyFeature[];

  /** States they're open to. Empty = any. Populated from our corpus. */
  targetStates?: string[];

  /** Tolerance for remote living. Drives proximity-to-town weighting
   * in the cold-start ranker. */
  drivingToleranceMin?: 10 | 30 | 60 | null;

  /** Free-form "what would make a property perfect for you?" — feeds
   * the AskClaude prompt as a persistent system-prompt fragment so
   * AI responses are personalized to the user's own words. Capped at
   * ~400 chars at the UI level. */
  vision?: string;

  /**
   * Free-form ranking hints — explicit instructions to the AI ranker
   * such as "deduct points if there's no creek access" or "boost
   * listings with owner financing". Distinct from `vision` (a
   * descriptive paragraph) — these are imperative rules. Joined into
   * the system prompt as a numbered list. Capped at ~600 chars.
   *
   * Surfaced via the dedicated /settings/ai-prompts page; not part
   * of the onboarding flow because it's a power-user feature.
   */
  rankingHints?: string;

  /** Timestamp the user completed onboarding, null if skipped. */
  completedAt?: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  budgetMinUsd: null,
  budgetMaxUsd: null,
  minAcreage: null,
  shopperMode: 'any',
  mustHaveFeatures: [],
  targetStates: [],
  drivingToleranceMin: null,
  vision: '',
  rankingHints: '',
};
