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
import { useAuth } from './useAuth';

/**
 * Saved-listings context — ONE shared source of truth for the whole
 * app.
 *
 * The previous per-hook implementation mounted a useEffect per
 * consuming component. With 300+ PropertyCards on the list view,
 * each rendering a bookmark button via useSavedListings(), we were
 * firing 300+ simultaneous api.auth.getUser() calls at page load
 * — plus N more any time the user state changed. That locked up
 * Supabase's auth layer and the actual `/rest/v1/saved_listings`
 * SELECT never had a chance to fire.
 *
 * SavedListingsProvider loads once on sign-in, exposes the Set to
 * all consumers, and owns the optimistic-update state. Mounts under
 * AuthProvider in main.tsx so it can react to auth changes.
 */
interface SavedListingsContextValue {
  savedIds: Set<string>;
  isSaved: (listingId: string) => boolean;
  toggle: (listingId: string) => Promise<void>;
  loading: boolean;
}

const SavedListingsContext = createContext<SavedListingsContextValue | null>(null);

interface SavedListingsProviderProps {
  children: ReactNode;
}

export const SavedListingsProvider = ({ children }: SavedListingsProviderProps) => {
  const { user, configured } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setSavedIds(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.savedListings
      .list()
      .then((ids) => {
        if (!cancelled) setSavedIds(new Set(ids));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, user]);

  const isSaved = useCallback(
    (listingId: string) => savedIds.has(listingId),
    [savedIds]
  );

  const toggle = useCallback(
    async (listingId: string) => {
      if (!user) throw new Error('Must be signed in to save listings');
      // Optimistic update: flip locally, then sync to backend; revert
      // on error so the UI stays honest.
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (next.has(listingId)) {
          next.delete(listingId);
        } else {
          next.add(listingId);
        }
        return next;
      });
      try {
        await api.savedListings.toggle(listingId);
      } catch (err) {
        // Revert
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (next.has(listingId)) {
            next.delete(listingId);
          } else {
            next.add(listingId);
          }
          return next;
        });
        throw err;
      }
    },
    [user]
  );

  const value = useMemo<SavedListingsContextValue>(
    () => ({ savedIds, isSaved, toggle, loading }),
    [savedIds, isSaved, toggle, loading]
  );

  return createElement(SavedListingsContext.Provider, { value }, children);
};

export const useSavedListings = (): SavedListingsContextValue => {
  const ctx = useContext(SavedListingsContext);
  if (ctx) return ctx;
  // Fallback for tests / stories outside the provider
  return {
    savedIds: new Set(),
    isSaved: () => false,
    toggle: async () => {
      throw new Error('SavedListingsProvider missing');
    },
    loading: false,
  };
};
