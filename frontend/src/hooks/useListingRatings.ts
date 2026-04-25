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
import { api, type ListingRating } from '../lib/api';
import { useAuth } from './useAuth';

/**
 * Listing ratings context — one Supabase fetch per auth change,
 * map shared with all consumers. Same pattern as saved/hidden lists.
 *
 * Domain: ratings are -2 (🚫 Hate), -1 (👎 Dislike), 1 (👍 Like),
 * 2 (🔥 Love). 0/null = "Meh / cleared" → row absent. Frontend
 * treats absent == 0 throughout.
 */
interface ListingRatingsContextValue {
  ratings: Map<string, ListingRating>;
  /** Returns 0 when not rated. */
  getRating: (listingId: string) => number;
  /** Pass null to clear back to Meh. Idempotent for same value. */
  setRating: (listingId: string, rating: ListingRating | null) => Promise<void>;
  loading: boolean;
}

const ListingRatingsContext = createContext<ListingRatingsContextValue | null>(
  null,
);

export const ListingRatingsProvider = ({ children }: { children: ReactNode }) => {
  const { user, configured } = useAuth();
  const [ratings, setRatingsMap] = useState<Map<string, ListingRating>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setRatingsMap(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.ratings
      .list()
      .then((m) => {
        if (!cancelled) setRatingsMap(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, user]);

  const getRating = useCallback(
    (id: string) => ratings.get(id) ?? 0,
    [ratings],
  );

  const setRating = useCallback(
    async (id: string, rating: ListingRating | null) => {
      if (!user) throw new Error('Must be signed in');
      // Optimistic update
      const prev = ratings;
      setRatingsMap((m) => {
        const next = new Map(m);
        if (rating === null) next.delete(id);
        else next.set(id, rating);
        return next;
      });
      try {
        await api.ratings.set(id, rating);
      } catch (err) {
        setRatingsMap(prev);
        throw err;
      }
    },
    [user, ratings],
  );

  const value = useMemo<ListingRatingsContextValue>(
    () => ({ ratings, getRating, setRating, loading }),
    [ratings, getRating, setRating, loading],
  );

  return createElement(ListingRatingsContext.Provider, { value }, children);
};

export const useListingRatings = (): ListingRatingsContextValue => {
  const ctx = useContext(ListingRatingsContext);
  if (ctx) return ctx;
  return {
    ratings: new Map(),
    getRating: () => 0,
    setRating: async () => {
      throw new Error('ListingRatingsProvider missing');
    },
    loading: false,
  };
};
