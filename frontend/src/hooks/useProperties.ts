import { useCallback, useMemo } from 'react';
import { Property, FilterState } from '../types/property';
import { useJsonAsset } from './useJsonAsset';

const applyFilters = (properties: Property[], filters: FilterState): Property[] => {
  return properties.filter((p) => {
    if (p.price < filters.minPrice || p.price > filters.maxPrice) return false;
    if (p.acreage < filters.minAcreage || p.acreage > filters.maxAcreage) return false;
    if (p.pricePerAcre > filters.maxPricePerAcre) return false;
    if (p.dealScore < filters.minDealScore) return false;
    if (filters.states.length > 0 && !filters.states.includes(p.location.state)) return false;
    if (filters.features.length > 0) {
      const hasAll = filters.features.every((f) => p.features.includes(f));
      if (!hasAll) return false;
    }
    if (filters.sources.length > 0 && !filters.sources.includes(p.source)) return false;
    // AI-derived filters — skip any listing that hasn't been enriched yet
    // when an AI filter is active, rather than treating missing = passing.
    if (filters.minHomesteadFit > 0) {
      if (p.homesteadFitScore === undefined) return false;
      if (p.homesteadFitScore < filters.minHomesteadFit) return false;
    }
    if (filters.aiTags.length > 0) {
      const tags = p.aiTags ?? [];
      const hasAll = filters.aiTags.every((t) => tags.includes(t));
      if (!hasAll) return false;
    }
    if (filters.hideWithRedFlags && (p.redFlags?.length ?? 0) > 0) return false;
    return true;
  });
};

// Module-scoped so useCallback sees a stable reference and the useJsonAsset
// effect doesn't re-fire every render. Cast narrows the JSON's inferred
// literal types to the runtime Property[] shape.
const loadSample = async () => {
  const mod = await import('../data/sample-listings.json');
  return { default: mod.default as unknown as Property[] };
};

const isEmptyArray = (d: Property[]) => d.length === 0;

export const useProperties = (filters: FilterState) => {
  const { data, loading, error, isSample } = useJsonAsset<Property[]>({
    assetPath: 'data/listings.json',
    loadFallback: useCallback(loadSample, []),
    isEmpty: isEmptyArray,
  });
  const allProperties = data ?? [];

  const filtered = useMemo(
    () => applyFilters(allProperties, filters),
    [allProperties, filters]
  );

  const sorted = useMemo(
    () =>
      [...filtered].sort((a: Property, b: Property) => {
        switch (filters.sortBy) {
          case 'priceAsc':
            return a.price - b.price;
          case 'priceDesc':
            return b.price - a.price;
          case 'pricePerAcre':
            return a.pricePerAcre - b.pricePerAcre;
          case 'acreage':
            return b.acreage - a.acreage;
          case 'dateFound':
            return new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime();
          case 'title':
            return a.title.localeCompare(b.title);
          case 'homesteadFit':
            return (b.homesteadFitScore ?? -1) - (a.homesteadFitScore ?? -1);
          case 'dealScore':
          default:
            return b.dealScore - a.dealScore;
        }
      }),
    [filtered, filters.sortBy]
  );

  const stats = useMemo(
    () => ({
      total: allProperties.length,
      filtered: filtered.length,
      hotDeals: allProperties.filter((p) => p.dealScore >= 80).length,
      avgScore:
        allProperties.length > 0
          ? Math.round(
              allProperties.reduce((sum, p) => sum + p.dealScore, 0) /
                allProperties.length
            )
          : 0,
    }),
    [allProperties, filtered]
  );

  return { properties: sorted, loading, error, stats, isSample };
};
