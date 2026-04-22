import type { User } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase';

/**
 * Auth hook — exposes the current user (or null), login/logout
 * callbacks, and a `configured` flag so components can hide auth
 * UI when Supabase env vars aren't set (e.g., first-time dev setup
 * or a public-fork deploy).
 *
 * Subscribes to auth state changes so the UI updates immediately
 * on OAuth callback without a reload.
 */
export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    // Initial load: check session on mount
    api.auth.getUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
    // Subscribe to changes (OAuth callback, signOut, token refresh)
    const unsubscribe = api.auth.onAuthChange((u) => {
      setUser(u);
    });
    return unsubscribe;
  }, [configured]);

  const loginWithGoogle = useCallback(async () => {
    await api.auth.signInWithGoogle();
  }, []);

  const loginWithEmail = useCallback(async (email: string) => {
    await api.auth.signInWithEmail(email);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.signOut();
  }, []);

  return { user, loading, configured, loginWithGoogle, loginWithEmail, logout };
};
