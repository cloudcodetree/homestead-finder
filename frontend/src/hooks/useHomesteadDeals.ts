import { useCallback } from 'react';
import { HomesteadDealsResult } from '../types/property';
import { useJsonAsset } from './useJsonAsset';

const loadSample = async () => {
  const mod = await import('../data/sample-homestead-deals.json');
  return { default: mod.default as unknown as HomesteadDealsResult };
};

const isEmpty = (d: HomesteadDealsResult) => !d.picks || d.picks.length === 0;

/**
 * Load `data/homestead_deals.json` with a bundled sample fallback. Same
 * pattern as useCurated / useProperties so behavior is predictable and
 * the dashboard can render offline in dev.
 */
export const useHomesteadDeals = () => {
  const { data, loading, error, isSample } = useJsonAsset<HomesteadDealsResult>({
    assetPath: 'data/homestead_deals.json',
    loadFallback: useCallback(loadSample, []),
    isEmpty,
  });
  return { deals: data, loading, error, isSample };
};
