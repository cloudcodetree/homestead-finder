import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Vendor-abstraction layer over Supabase.
 *
 * All Supabase-specific code lives in this file. Components call
 * `api.auth.*` and `api.savedListings.*` without knowing which
 * backend implements them. When we need to migrate off Supabase
 * (self-hosted GoTrue, AWS Cognito + RDS, Clerk, etc.), only this
 * file changes — the 20+ call sites in components / hooks stay
 * exactly as-is.
 *
 * Each method returns plain types (User / string[]) rather than
 * Supabase-specific types at the public surface, so consumers don't
 * leak vendor types throughout the codebase.
 */

const SAVED_LISTINGS_TABLE = 'saved_listings';

// ── Auth ─────────────────────────────────────────────────────────

const getUser = async (): Promise<User | null> => {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

const signInWithGoogle = async (): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Return to the current page after OAuth — avoids bouncing back
      // to "/" and losing whatever listing / filter the user was on.
      redirectTo: window.location.href,
    },
  });
  if (error) throw error;
};

/**
 * Email magic-link (aka OTP). Supabase sends a one-time sign-in
 * link to the email; clicking it opens `redirectTo` with a session
 * cookie, same effect as completing an OAuth round-trip. No password
 * ever gets set — this is passwordless by design. Returns silently
 * on success so the caller can render "check your inbox" UI.
 */
const signInWithEmail = async (email: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const trimmed = email.trim();
  if (!trimmed) throw new Error('Email required');
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: window.location.href,
    },
  });
  if (error) throw error;
};

const signOut = async (): Promise<void> => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

/**
 * Subscribe to auth state changes. Returns an unsubscribe function
 * for the effect-cleanup convention.
 */
const onAuthChange = (cb: (user: User | null) => void): (() => void) => {
  if (!supabase) {
    cb(null);
    return () => {};
  }
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
};

// ── Saved listings ───────────────────────────────────────────────

/**
 * Return an array of listing IDs the current user has saved. Empty
 * array if not logged in or if Supabase isn't configured — callers
 * should treat "no saved listings" and "no auth" as equivalent for
 * UI purposes.
 */
const listSaved = async (): Promise<string[]> => {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .select('listing_id')
    .eq('user_id', user.id);
  if (error || !data) return [];
  return data.map((r) => r.listing_id as string);
};

/**
 * Toggle a listing's saved state for the current user. Returns the
 * new state (true = saved, false = removed). Throws if the user
 * isn't logged in — UI should gate the bookmark button on auth.
 */
const toggleSaved = async (listingId: string): Promise<boolean> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');

  // Check current state first so we return the correct new value
  const { data: existing } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .select('listing_id')
    .eq('user_id', user.id)
    .eq('listing_id', listingId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from(SAVED_LISTINGS_TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('listing_id', listingId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from(SAVED_LISTINGS_TABLE)
      .insert({ user_id: user.id, listing_id: listingId });
    if (error) throw error;
    return true;
  }
};

export const api = {
  auth: {
    getUser,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    onAuthChange,
  },
  savedListings: {
    list: listSaved,
    toggle: toggleSaved,
  },
};
