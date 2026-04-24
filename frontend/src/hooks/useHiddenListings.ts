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
 * Hidden-listings context — "not interested" marks, mirror of
 * useSavedListings. One Supabase fetch per auth change, all consumers
 * share the same Set.
 *
 * Design matches useSavedListings for consistency:
 *   - per-mount hooks would cause N parallel getUser() calls on the
 *     300+ PropertyCard list view; context collapses that to one.
 *   - optimistic local flip + revert-on-error keeps the UI responsive
 *     without a round-trip per click.
 */
interface HiddenListingsContextValue {
  hiddenIds: Set<string>;
  isHidden: (listingId: string) => boolean;
  toggle: (listingId: string) => Promise<void>;
  loading: boolean;
}

const HiddenListingsContext = createContext<HiddenListingsContextValue | null>(
  null,
);

interface HiddenListingsProviderProps {
  children: ReactNode;
}

export const HiddenListingsProvider = ({
  children,
}: HiddenListingsProviderProps) => {
  const { user, configured } = useAuth();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user) {
      setHiddenIds(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.hiddenListings
      .list()
      .then((ids) => {
        if (!cancelled) setHiddenIds(new Set(ids));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, user]);

  const isHidden = useCallback(
    (id: string) => hiddenIds.has(id),
    [hiddenIds],
  );

  const toggle = useCallback(
    async (id: string) => {
      if (!user) throw new Error('Must be signed in to hide listings');
      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        await api.hiddenListings.toggle(id);
      } catch (err) {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        throw err;
      }
    },
    [user],
  );

  const value = useMemo<HiddenListingsContextValue>(
    () => ({ hiddenIds, isHidden, toggle, loading }),
    [hiddenIds, isHidden, toggle, loading],
  );

  return createElement(
    HiddenListingsContext.Provider,
    { value },
    children,
  );
};

export const useHiddenListings = (): HiddenListingsContextValue => {
  const ctx = useContext(HiddenListingsContext);
  if (ctx) return ctx;
  return {
    hiddenIds: new Set(),
    isHidden: () => false,
    toggle: async () => {
      throw new Error('HiddenListingsProvider missing');
    },
    loading: false,
  };
};
