import { useCallback, useEffect, useState } from 'react';
import { api, type NotifyCadence, type SavedSearch } from '../lib/api';
import { useAuth } from './useAuth';

/**
 * Saved-searches hook. Loads once per auth change, mutations are
 * optimistic where cheap (delete) and server-first elsewhere (create /
 * update — the server returns the canonical row incl. timestamps).
 *
 * Not wrapped in a context like useSavedListings because consumers are
 * few (filter panel + account menu) — no per-card render concern.
 */
export const useSavedSearches = () => {
  const { user, configured } = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!configured || !user) {
      setSearches([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.savedSearches.list();
      setSearches(rows);
    } finally {
      setLoading(false);
    }
  }, [configured, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (
      name: string,
      filters: Record<string, unknown>,
      cadence: NotifyCadence = 'daily',
    ) => {
      const row = await api.savedSearches.create(name, filters, cadence);
      setSearches((prev) => [row, ...prev]);
      return row;
    },
    [],
  );

  const update = useCallback(
    async (
      id: string,
      updates: Partial<Pick<SavedSearch, 'name' | 'filters' | 'notifyCadence'>>,
    ) => {
      await api.savedSearches.update(id, updates);
      setSearches((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      );
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    // Optimistic — put the row back on failure
    const prev = searches;
    setSearches((list) => list.filter((s) => s.id !== id));
    try {
      await api.savedSearches.delete(id);
    } catch (err) {
      setSearches(prev);
      throw err;
    }
  }, [searches]);

  return { searches, loading, refresh, create, update, remove };
};
