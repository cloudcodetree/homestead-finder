import { useEffect, useMemo, useState } from 'react';
import { Property } from '../types/property';
import { useProperties } from './useProperties';
import { DEFAULT_FILTERS } from '../types/property';
import { idbGet, idbSet } from '../utils/idbCache';

/**
 * Fetch a single listing's full detail record from
 * `data/listings/<id>.json`, produced by `scraper/shard_listings.py`.
 *
 * Why a separate hook: the slim listings_index.json that powers
 * Browse strips heavy detail-only fields (full description, AI
 * summary, geoEnrichment, investmentBreakdown axes/signals, full
 * taxSale, voting). The detail page needs them — but instead of
 * shipping all that for 700+ listings on every Browse load, we
 * fetch the per-id record on demand here.
 *
 * Falls back gracefully:
 *   1. Per-id file (`data/listings/<id>.json`) — what production
 *      deploys after shard_listings runs.
 *   2. Slim index entry (already in memory via `useProperties`)
 *      so the detail page renders SOMETHING immediately even before
 *      the per-id file lands.
 *   3. Null when the listing isn't in either set.
 *
 * IDB-cached: per-id files cache for 24h since they only change on
 * the daily scrape. Repeat opens of the same listing are sub-100ms.
 */

const PER_ID_FRESH_MS = 24 * 60 * 60 * 1000;

interface UsePropertyDetailResult {
  property: Property | null;
  /** True when we're still waiting on the per-id fetch and have no
   *  index fallback yet. Detail page can show a spinner. */
  loading: boolean;
  /** True when we're rendering the slim-index version and the per-id
   *  fetch is still in flight. Detail page can render but hide
   *  detail-only panels (geoEnrichment-derived viability, voting,
   *  investmentBreakdown axis bars) to avoid showing stale or
   *  incomplete data. */
  hydrating: boolean;
}

export const usePropertyDetail = (id: string | undefined): UsePropertyDetailResult => {
  // Slim-index lookup is essentially free (just a Map find on the
  // already-loaded array) — gives us SOMETHING to render
  // immediately while the per-id fetch is in flight.
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  const slim = useMemo(
    () => (id ? allProperties.find((p) => p.id === id) ?? null : null),
    [id, allProperties],
  );

  const [full, setFull] = useState<Property | null>(null);
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    if (!id) {
      setFull(null);
      return;
    }
    let cancelled = false;
    setHydrating(true);

    void (async () => {
      const cacheKey = `data/listings/${id}.json`;
      // 1) IDB cache
      const cached = await idbGet<Property>(cacheKey);
      const fresh = cached && Date.now() - cached.cachedAt < PER_ID_FRESH_MS;
      if (fresh && cached && !cancelled) {
        setFull(cached.value);
        // Background refetch to keep cache warm for next visit.
        void backgroundFetch(id);
        setHydrating(false);
        return;
      }
      // 2) Network fetch
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}data/listings/${id}.json`);
        if (r.ok) {
          const data = (await r.json()) as Property;
          if (!cancelled) {
            setFull(data);
            void idbSet(cacheKey, data);
          }
        } else if (cached && !cancelled) {
          // Network 404 (likely the per-id file isn't deployed yet) —
          // surface stale cache rather than nothing.
          setFull(cached.value);
        }
      } catch {
        if (cached && !cancelled) setFull(cached.value);
      }
      if (!cancelled) setHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Merge: prefer full record fields when present, else fall back to
  // slim index. The slim index is a strict subset, so this is safe —
  // we never end up with a "merged" record that has detail-only
  // fields from one mismatched source.
  const property = full ?? slim;
  const loading = !property;

  return { property, loading, hydrating };
};

/** Fire-and-forget background refresh for the per-id cache. */
const backgroundFetch = async (id: string): Promise<void> => {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/listings/${id}.json`);
    if (!r.ok) return;
    const data = (await r.json()) as Property;
    await idbSet(`data/listings/${id}.json`, data);
  } catch {
    // Swallow — non-fatal.
  }
};
