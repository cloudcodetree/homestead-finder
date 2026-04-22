import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client singleton. Reads URL + anon key from Vite env vars
 * so the build pipeline can bake them into the static bundle without
 * committing them to git. Both values are safe for public exposure —
 * the anon key is specifically designed to ship in client code; all
 * database access goes through Row-Level Security policies (see the
 * `saved_listings` migration for what a logged-in user can actually
 * touch). If the env vars are missing we fall back to null so the
 * app boots cleanly and auth features simply no-op.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          // Persist session in localStorage so the user stays logged in
          // across tabs + reloads. Default, but called out explicitly
          // because the static site has no server-side session.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true, // required for OAuth callback round-trip
        },
      })
    : null;

export const isSupabaseConfigured = (): boolean => supabase !== null;
