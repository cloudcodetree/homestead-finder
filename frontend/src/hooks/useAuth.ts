import type { User } from '@supabase/supabase-js';
import { createContext, createElement, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase';

/**
 * Auth context — one shared subscription for the whole app.
 *
 * We previously had each `useAuth()` call site subscribing to
 * `supabase.auth.onAuthChange` on its own. Under React Strict Mode
 * (which double-mounts effects in dev) that produced a swarm of
 * subscriptions competing for the same IndexedDB lock on the auth
 * token — `@supabase/gotrue-js` would log "Lock not released within
 * 5000ms" warnings, and sign-out events sometimes failed to
 * propagate to every subscriber, leaving the UI stuck on the
 * signed-in state.
 *
 * AuthProvider owns the single subscription and broadcasts to
 * consumers via context, which is the pattern Supabase themselves
 * recommend for Next.js / Vite apps.
 */
interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.auth.getUser().then((u) => {
      if (!cancelled) {
        setUser(u);
        setLoading(false);
      }
    });
    const unsubscribe = api.auth.onAuthChange((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [configured]);

  const loginWithGoogle = useCallback(async () => {
    await api.auth.signInWithGoogle();
  }, []);

  const loginWithEmail = useCallback(async (email: string) => {
    await api.auth.signInWithEmail(email);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.signOut();
    // Force-clear local state even if onAuthChange hasn't fired yet
    // (known issue under Strict Mode + the IndexedDB auth-lock path).
    // The next getSession() call picks up the cleared state anyway;
    // this just makes the UI respond immediately.
    setUser(null);
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, configured, loginWithGoogle, loginWithEmail, logout } },
    children
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  // Fallback for any caller outside the provider — behaves the same
  // as the old hook so we can migrate component-by-component. The
  // provider is always mounted at the app root in main.tsx, so
  // this branch only fires in tests or stories.
  return {
    user: null,
    loading: false,
    configured: isSupabaseConfigured(),
    loginWithGoogle: api.auth.signInWithGoogle,
    loginWithEmail: api.auth.signInWithEmail,
    logout: api.auth.signOut,
  };
};
