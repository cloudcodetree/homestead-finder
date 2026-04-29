import { useEffect, useState } from 'react';

/**
 * Fetch a JSON asset from the deployed site (relative to BASE_URL), with a
 * fallback to a bundled sample module when the live asset is missing or
 * empty. Used for data files that the CI scraper writes but which may not
 * exist in local dev.
 *
 *   const { data, loading, error } = useJsonAsset<Property[]>({
 *     assetPath: 'data/listings.json',
 *     loadFallback: () => import('../data/sample-listings.json'),
 *     isEmpty: (d) => d.length === 0,
 *   });
 *
 * SWR-style module-level cache: the first consumer for a given
 * `assetPath` triggers a single fetch; every subsequent consumer that
 * mounts during or after that fetch reuses the same Promise. Without
 * this, every component that calls useProperties / useCurated /
 * useCountyMedians fires its own fetch (~30 PropertyCards × 12 MB
 * listings.json = ~360 MB the browser will refuse to schedule, then
 * the page goes ERR_INSUFFICIENT_RESOURCES).
 */
interface Options<T> {
  /** Path under `import.meta.env.BASE_URL` to fetch. */
  assetPath: string;
  /** Dynamic import of the bundled sample — called only if the live fetch fails or returns empty. */
  loadFallback: () => Promise<{ default: T }>;
  /** Treat a successful response as "no data yet" if this returns true. */
  isEmpty?: (data: T) => boolean;
}

interface Result<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True iff the loaded data came from the bundled sample fallback. */
  isSample: boolean;
}

interface CacheEntry<T> {
  promise: Promise<{ data: T; isSample: boolean }>;
  /** Resolved value cached so newly-mounted consumers can render
   * synchronously instead of flashing a loading state. */
  resolved?: { data: T; isSample: boolean };
}

const cache = new Map<string, CacheEntry<unknown>>();

const fetchOnce = <T>(
  assetPath: string,
  loadFallback: () => Promise<{ default: T }>,
  isEmpty: ((data: T) => boolean) | undefined,
): CacheEntry<T> => {
  const existing = cache.get(assetPath) as CacheEntry<T> | undefined;
  if (existing) return existing;
  const promise = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${assetPath}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const fetched = (await response.json()) as T;
      if (isEmpty?.(fetched)) throw new Error('empty');
      return { data: fetched, isSample: false };
    } catch {
      const fallback = await loadFallback();
      return { data: fallback.default, isSample: true };
    }
  })();
  const entry: CacheEntry<T> = { promise };
  // Stamp the resolved snapshot onto the entry so later consumers
  // skip the loading flash entirely.
  promise.then(
    (r) => {
      entry.resolved = r;
    },
    () => {
      // Errors are surfaced to consumers via their own try/catch; the
      // entry stays so we don't refetch on every retry.
    },
  );
  cache.set(assetPath, entry as CacheEntry<unknown>);
  return entry;
};

export const useJsonAsset = <T>({ assetPath, loadFallback, isEmpty }: Options<T>): Result<T> => {
  // Eagerly hydrate from the cached snapshot if the fetch already
  // resolved before this consumer mounted. Avoids one tick of `loading=true`.
  const entry = fetchOnce<T>(assetPath, loadFallback, isEmpty);
  const initial = entry.resolved;
  const [data, setData] = useState<T | null>(initial ? initial.data : null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(initial ? initial.isSample : false);

  useEffect(() => {
    if (initial) return; // already settled — nothing to await
    let cancelled = false;
    entry.promise.then(
      (resolved) => {
        if (cancelled) return;
        setData(resolved.data);
        setIsSample(resolved.isSample);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // entry.promise + initial are derived from `assetPath` — keep that
    // as the only meaningful dep so the effect doesn't re-fire on
    // unstable callback identities (the previous bug that caused the
    // 30× refetch storm).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetPath]);

  return { data, loading, error, isSample };
};
