import { useEffect, useState } from 'react';
import { idbGet, idbSet } from '../utils/idbCache';

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
  /** Optional remote fallback path tried before the bundled sample.
   *  Used by useProperties to fall through from the slim index
   *  (data/listings_index.json) to the legacy combined file
   *  (data/listings.json) when the index hasn't been generated yet. */
  fallbackAssetPath?: string;
  /** Dynamic import of the bundled sample — called only if both the
   *  primary and remote-fallback paths fail or return empty. */
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

// IndexedDB cache window — entries fresher than this skip the network
// entirely on the next visit. Currently 1 hour, which works because
// our scraper publishes once per day (post-deploy bytes are stable
// for at least an hour) and any in-tab navigation reuses the
// module-level Promise cache regardless of TTL.
const FRESH_MS = 60 * 60 * 1000;

const tryFetch = async <T>(
  path: string,
  isEmpty: ((data: T) => boolean) | undefined,
): Promise<T | null> => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!response.ok) return null;
    const fetched = (await response.json()) as T;
    if (isEmpty?.(fetched)) return null;
    return fetched;
  } catch {
    return null;
  }
};

const fetchOnce = <T>(
  assetPath: string,
  loadFallback: () => Promise<{ default: T }>,
  isEmpty: ((data: T) => boolean) | undefined,
  fallbackAssetPath?: string,
): CacheEntry<T> => {
  const existing = cache.get(assetPath) as CacheEntry<T> | undefined;
  if (existing) return existing;
  const promise = (async () => {
    // 1) Try IDB first — instant render on repeat visits while we
    //    revalidate in the background. SWR-style.
    const cached = await idbGet<T>(assetPath);
    const fresh = cached && Date.now() - cached.cachedAt < FRESH_MS;
    if (fresh && cached) {
      // Cached entry is fresh — kick off a background refetch but
      // resolve immediately with the cached value so the UI doesn't
      // wait. Background fetch updates IDB for the next visit.
      void backgroundRefresh<T>(assetPath, isEmpty);
      return { data: cached.value, isSample: false };
    }
    // 2) Stale or missing — primary network path.
    const primary = await tryFetch<T>(assetPath, isEmpty);
    if (primary !== null) {
      void idbSet(assetPath, primary);
      return { data: primary, isSample: false };
    }
    // 3) Primary failed — try the remote fallback path (e.g. legacy
    //    listings.json when the slim index isn't deployed yet).
    if (fallbackAssetPath) {
      const fb = await tryFetch<T>(fallbackAssetPath, isEmpty);
      if (fb !== null) {
        // Don't write to the primary's IDB key — keep its slot empty
        // so a future deploy of the primary populates it cleanly.
        return { data: fb, isSample: false };
      }
    }
    // 4) Both network paths failed — prefer stale cache over the
    //    bundled sample so users still see real data when offline.
    if (cached) return { data: cached.value, isSample: false };
    const bundled = await loadFallback();
    return { data: bundled.default, isSample: true };
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

/** Fire-and-forget background refresh when a cached entry was served.
 *  Updates IDB for the next visit but does not affect the current
 *  resolved Promise — consumers already rendered with the cached
 *  value. */
const backgroundRefresh = async <T>(
  assetPath: string,
  isEmpty: ((data: T) => boolean) | undefined,
): Promise<void> => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${assetPath}`);
    if (!response.ok) return;
    const fetched = (await response.json()) as T;
    if (isEmpty?.(fetched)) return;
    await idbSet(assetPath, fetched);
  } catch {
    // Swallow — background refresh failures are non-fatal.
  }
};

export const useJsonAsset = <T>({
  assetPath,
  fallbackAssetPath,
  loadFallback,
  isEmpty,
}: Options<T>): Result<T> => {
  // Eagerly hydrate from the cached snapshot if the fetch already
  // resolved before this consumer mounted. Avoids one tick of `loading=true`.
  const entry = fetchOnce<T>(assetPath, loadFallback, isEmpty, fallbackAssetPath);
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
