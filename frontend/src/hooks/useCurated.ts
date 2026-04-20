import { useEffect, useState } from 'react';
import { CurationResult } from '../types/property';

/**
 * Load the curated "top picks" file (data/curated.json) with a fallback to
 * the local sample. Works the same way as useProperties so the two hooks
 * stay in sync and the dashboard can offline-render in dev.
 */
export const useCurated = () => {
  const [curation, setCuration] = useState<CurationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        let data: CurationResult;
        try {
          const response = await fetch(
            `${import.meta.env.BASE_URL}data/curated.json`
          );
          if (!response.ok) throw new Error('No curated data yet');
          const fetched = (await response.json()) as CurationResult;
          if (!fetched.picks || fetched.picks.length === 0)
            throw new Error('No curated picks yet');
          data = fetched;
        } catch {
          const sample = await import('../data/sample-curated.json');
          data = sample.default as CurationResult;
        }
        setCuration(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load curated picks'
        );
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return { curation, loading, error };
};
