import { useCallback } from 'react';
import { useJsonAsset } from './useJsonAsset';

export interface NewsItem {
  id: string;
  category?: 'market' | 'site';
  title: string;
  body: string;
  publishedAt: string;
  /** Visual treatment hint — `highlight` gets a green accent strip;
   * `info` is the default neutral card. */
  tone?: 'info' | 'highlight';
}

interface NewsBundle {
  items: NewsItem[];
}

const isEmpty = (d: NewsBundle) => !d.items || d.items.length === 0;
const emptyBundle: NewsBundle = { items: [] };

const loadMarketSample = async () => ({ default: emptyBundle });
const loadSiteSample = async () => ({ default: emptyBundle });

/**
 * Operator-curated news that doesn't change per request — small JSON
 * files committed alongside the corpus. We refresh them by editing
 * the JSON in `data/` and pushing a commit.
 *
 * Two slots so the home page can render Market vs Site updates as
 * separate strips without filtering by category at the call site.
 */
export const useMarketNews = () => {
  const { data } = useJsonAsset<NewsBundle>({
    assetPath: 'data/market_news.json',
    loadFallback: useCallback(loadMarketSample, []),
    isEmpty,
  });
  return data?.items ?? [];
};

export const useSiteUpdates = () => {
  const { data } = useJsonAsset<NewsBundle>({
    assetPath: 'data/site_updates.json',
    loadFallback: useCallback(loadSiteSample, []),
    isEmpty,
  });
  return data?.items ?? [];
};
