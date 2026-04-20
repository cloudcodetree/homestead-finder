import { useCallback } from 'react';
import { CurationResult } from '../types/property';
import { useJsonAsset } from './useJsonAsset';

const loadSample = () => import('../data/sample-curated.json');

const isEmpty = (d: CurationResult) => !d.picks || d.picks.length === 0;

/**
 * Load `data/curated.json` with a fallback to the bundled sample. When the
 * real curated file exists but is misaligned (e.g. the dev just scraped
 * real listings but hasn't run `python -m scraper.curate` yet) the hook
 * will return the sample; the dashboard uses `isSample` to show a hint.
 */
export const useCurated = () => {
  const { data, loading, error, isSample } = useJsonAsset<CurationResult>({
    assetPath: 'data/curated.json',
    loadFallback: useCallback(loadSample, []),
    isEmpty,
  });
  return { curation: data, loading, error, isSample };
};
