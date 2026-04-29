import { useAuth } from './useAuth';

/**
 * Access tier — what the current visitor is allowed to see.
 *
 *   anonymous → no signup, can browse but link-out to source sites
 *               and external research is hidden behind a "Sign up
 *               to view" gate. This is to prevent reverse-searching
 *               our corpus on LandWatch / United Country / etc.
 *               using the title + county + acreage combo.
 *   signed-in → currently treated as fully unlocked. The paid tier
 *               and per-day click cap are a planned follow-up (see
 *               BACKLOG: "Click-through cap for free signups").
 *
 * Returning a single string instead of a boolean leaves room for
 * the third tier without retrofitting every callsite later.
 */
export type AccessTier = 'anonymous' | 'signed_in';

export interface AccessTierState {
  tier: AccessTier;
  /** True when the user can see + click through to the listing's
   * original source URL (LandWatch detail page, etc.) and to
   * external research deep-links (AcreValue, USDA WSS, FEMA, etc.). */
  canSeeSourceLinks: boolean;
}

export const useAccessTier = (): AccessTierState => {
  const { user } = useAuth();
  if (user) {
    return { tier: 'signed_in', canSeeSourceLinks: true };
  }
  return { tier: 'anonymous', canSeeSourceLinks: false };
};
