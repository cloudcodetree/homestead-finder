import { supabase } from './supabase';

/**
 * Subscription state + feature gating.
 *
 * Free tier is the default for any user without a row in
 * user_subscriptions. Stripe is the source of truth for billing; the
 * `user_subscriptions` table is a denormalized cache populated by the
 * stripe-webhook Edge Function.
 *
 * Free-tier limits per the business plan (Phase 1):
 *   - 5 saved listings (gate the 6th save with an upgrade prompt)
 *   - 1 project (gate the 2nd create with an upgrade prompt)
 *   - No "Recommended for you" sort (gate the option in the dropdown)
 *
 * Paid features (monthly/annual):
 *   - Unlimited saves
 *   - Unlimited projects
 *   - Recommended sort enabled
 *   - AI enrichment (currently runs locally via claude -p; gate
 *     surfaces when we move it server-side)
 *   - Image upload + file context (#14 vision item)
 */

export type SubscriptionPlan = 'free' | 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export const FREE_SUBSCRIPTION: Subscription = {
  plan: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// ── Free-tier limits — single source of truth ────────────────────
export const FREE_TIER_LIMITS = {
  savedListings: 5,
  projects: 1,
} as const;

// ── Stripe Payment Links ─────────────────────────────────────────
// Operator creates two products in Stripe Dashboard ($19/mo, $190/yr),
// generates a Payment Link for each, and pastes the URLs into
// frontend/.env.local. We don't hardcode them — different envs (dev,
// staging, prod) may use different links during testing.
export const STRIPE_PAYMENT_LINKS = {
  monthly: import.meta.env.VITE_STRIPE_LINK_MONTHLY ?? '',
  annual: import.meta.env.VITE_STRIPE_LINK_ANNUAL ?? '',
} as const;

export const isPaid = (sub: Subscription): boolean =>
  sub.plan !== 'free' &&
  (sub.status === 'active' || sub.status === 'trialing');

/** Fetch the signed-in user's subscription from Supabase, or return
 * the free default. Never throws — null subscription is the typical
 * state, not an error. */
export async function fetchSubscription(): Promise<Subscription> {
  if (!supabase) return FREE_SUBSCRIPTION;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return FREE_SUBSCRIPTION;
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return FREE_SUBSCRIPTION;
  return {
    plan: data.plan as SubscriptionPlan,
    status: data.status as SubscriptionStatus,
    currentPeriodEnd: (data.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
  };
}
