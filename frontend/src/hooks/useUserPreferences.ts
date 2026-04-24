import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api } from '../lib/api';
import { DEFAULT_PREFERENCES, UserPreferences } from '../types/preferences';
import { useAuth } from './useAuth';

interface UserPreferencesContextValue {
  preferences: UserPreferences;
  /** True when onboarding is complete (row has completed_at stamp).
   * False when the user hasn't gone through onboarding yet OR is not
   * logged in. The OnboardingModal uses this + `loading` to decide
   * whether to prompt. */
  isComplete: boolean;
  loading: boolean;
  save: (next: UserPreferences, opts?: { complete?: boolean }) => Promise<void>;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(
  null,
);

/**
 * Loads the signed-in user's preferences once, exposes save().
 * Mirrors the SavedListingsProvider pattern — one Supabase fetch per
 * auth change, consumers share the state. Not a critical render-path
 * hook (only the onboarding modal + settings page read it heavily)
 * so we don't worry about over-invalidation.
 */
export const UserPreferencesProvider = ({ children }: { children: ReactNode }) => {
  const { user, configured } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isComplete, setIsComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setPreferences(DEFAULT_PREFERENCES);
      setIsComplete(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.preferences
      .get()
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setPreferences(DEFAULT_PREFERENCES);
          setIsComplete(false);
          return;
        }
        // Merge stored preferences over defaults so new fields added
        // after a row was written still get the default value in memory.
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...(row.preferences as Partial<UserPreferences>),
        });
        setIsComplete(Boolean(row.completedAt));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, user]);

  const save = useCallback(
    async (next: UserPreferences, opts: { complete?: boolean } = {}) => {
      if (!user) throw new Error('Must be signed in');
      // Optimistic local update — revert on error.
      const prev = preferences;
      const prevComplete = isComplete;
      setPreferences(next);
      if (opts.complete) setIsComplete(true);
      try {
        await api.preferences.upsert(
          next as unknown as Record<string, unknown>,
          { completed: opts.complete },
        );
      } catch (err) {
        setPreferences(prev);
        setIsComplete(prevComplete);
        throw err;
      }
    },
    [user, preferences, isComplete],
  );

  const value = useMemo<UserPreferencesContextValue>(
    () => ({ preferences, isComplete, loading, save }),
    [preferences, isComplete, loading, save],
  );

  return createElement(UserPreferencesContext.Provider, { value }, children);
};

export const useUserPreferences = (): UserPreferencesContextValue => {
  const ctx = useContext(UserPreferencesContext);
  if (ctx) return ctx;
  return {
    preferences: DEFAULT_PREFERENCES,
    isComplete: false,
    loading: false,
    save: async () => {
      throw new Error('UserPreferencesProvider missing');
    },
  };
};
