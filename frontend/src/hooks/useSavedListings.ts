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
import { FREE_TIER_LIMITS } from '../lib/billing';
import { useAuth } from './useAuth';
import { useSubscription } from './useSubscription';

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
  getNote: (listingId: string) => string;
  updateNote: (listingId: string, note: string) => Promise<void>;
  loading: boolean;
  /** True iff the current user has hit the free-tier saved-listing
   * limit and trying to save another would prompt an upgrade. */
  atFreeLimit: boolean;
}

/** Thrown when a free-tier user tries to exceed their saved-listing
 * limit. UI catches this to surface the UpgradeModal. */
export class FreeTierLimitError extends Error {
  reason: 'saved_listings_limit';
  constructor() {
    super('Free tier saved-listings limit reached');
    this.reason = 'saved_listings_limit';
  }
}

const SavedListingsContext = createContext<SavedListingsContextValue | null>(null);

interface SavedListingsProviderProps {
  children: ReactNode;
}

export const SavedListingsProvider = ({ children }: SavedListingsProviderProps) => {
  const { user, configured } = useAuth();
  const { paid } = useSubscription();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Notes are stored alongside savedIds — one loads both in a single
  // query, avoiding a round-trip-per-detail-open.
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setSavedIds(new Set());
      setNotes(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.savedListings
      .list()
      .then((rows) => {
        if (cancelled) return;
        setSavedIds(new Set(rows.map((r) => r.listingId)));
        setNotes(new Map(rows.map((r) => [r.listingId, r.note])));
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
      // Free-tier limit gate: only blocks ADDS, not removes. Saving
      // your 6th listing as a free user throws FreeTierLimitError;
      // unsaving anything always works.
      if (!paid && !savedIds.has(listingId) && savedIds.size >= FREE_TIER_LIMITS.savedListings) {
        throw new FreeTierLimitError();
      }
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
    [user, paid, savedIds]
  );

  const getNote = useCallback(
    (listingId: string) => notes.get(listingId) ?? '',
    [notes]
  );

  const updateNote = useCallback(
    async (listingId: string, note: string) => {
      if (!user) throw new Error('Must be signed in');
      // Optimistic update — flip local cache, revert on error.
      const prev = notes.get(listingId) ?? '';
      setNotes((m) => {
        const next = new Map(m);
        next.set(listingId, note);
        return next;
      });
      try {
        await api.savedListings.updateNote(listingId, note);
      } catch (err) {
        setNotes((m) => {
          const next = new Map(m);
          next.set(listingId, prev);
          return next;
        });
        throw err;
      }
    },
    [user, notes]
  );

  const atFreeLimit =
    !paid && savedIds.size >= FREE_TIER_LIMITS.savedListings;

  const value = useMemo<SavedListingsContextValue>(
    () => ({ savedIds, isSaved, toggle, getNote, updateNote, loading, atFreeLimit }),
    [savedIds, isSaved, toggle, getNote, updateNote, loading, atFreeLimit]
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
    getNote: () => '',
    updateNote: async () => {
      throw new Error('SavedListingsProvider missing');
    },
    loading: false,
    atFreeLimit: false,
  };
};
