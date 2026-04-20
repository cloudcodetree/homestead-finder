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

export const useJsonAsset = <T>({
  assetPath,
  loadFallback,
  isEmpty,
}: Options<T>): Result<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        let result: T;
        let fromSample = false;
        try {
          const response = await fetch(
            `${import.meta.env.BASE_URL}${assetPath}`
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const fetched = (await response.json()) as T;
          if (isEmpty?.(fetched)) throw new Error('empty');
          result = fetched;
        } catch {
          const fallback = await loadFallback();
          result = fallback.default;
          fromSample = true;
        }
        if (cancelled) return;
        setData(result);
        setIsSample(fromSample);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [assetPath, loadFallback, isEmpty]);

  return { data, loading, error, isSample };
};
