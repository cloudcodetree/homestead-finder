import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './useAuth';

/**
 * Saved-listings hook. Loads the current user's saved IDs on mount
 * and when the auth state changes; exposes a `toggle(id)` callback
 * that optimistically updates local state then syncs to the backend.
 *
 * If the user isn't logged in, `savedIds` is always empty and
 * `toggle` throws — the PropertyCard bookmark UI should gate on
 * `user` from useAuth and prompt login if absent.
 */
export const useSavedListings = () => {
  const { user, configured } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setSavedIds(new Set());
      return;
    }
    setLoading(true);
    api.savedListings
      .list()
      .then((ids) => setSavedIds(new Set(ids)))
      .finally(() => setLoading(false));
  }, [configured, user]);

  const isSaved = useCallback((listingId: string) => savedIds.has(listingId), [savedIds]);

  const toggle = useCallback(
    async (listingId: string) => {
      if (!user) throw new Error('Must be signed in to save listings');
      // Optimistic update — revert on error so the UI stays in sync
      const prev = new Set(savedIds);
      const next = new Set(savedIds);
      if (next.has(listingId)) {
        next.delete(listingId);
      } else {
        next.add(listingId);
      }
      setSavedIds(next);
      try {
        await api.savedListings.toggle(listingId);
      } catch (err) {
        setSavedIds(prev);
        throw err;
      }
    },
    [savedIds, user]
  );

  return { savedIds, isSaved, toggle, loading };
};
