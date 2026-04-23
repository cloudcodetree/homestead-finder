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
 * Return the saved-listings set for the current user as a map of
 * listingId → optional note text. Empty map if not logged in or if
 * Supabase isn't configured.
 *
 * Returning a record (rather than just ids) lets consumers render the
 * note inline without a second round-trip per listing detail open.
 * Notes are usually empty, so payload stays small.
 */
export interface SavedListingRow {
  listingId: string;
  note: string;
}

const listSaved = async (): Promise<SavedListingRow[]> => {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .select('listing_id, note')
    .eq('user_id', user.id);
  if (error || !data) return [];
  return data.map((r) => ({
    listingId: r.listing_id as string,
    note: (r.note as string | null) ?? '',
  }));
};

/**
 * Update (or clear) the private note on a saved listing. The row must
 * already exist — caller is responsible for toggling the save first.
 * Passing an empty string clears the note column.
 */
const updateNote = async (listingId: string, note: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const trimmed = note.trim();
  const { error } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .update({ note: trimmed ? trimmed : null })
    .eq('user_id', user.id)
    .eq('listing_id', listingId);
  if (error) throw error;
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
    updateNote,
  },
};
