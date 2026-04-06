import { useState, useEffect, useMemo } from 'react';
import { Property, FilterState } from '../types/property';

const applyFilters = (properties: Property[], filters: FilterState): Property[] => {
  return properties.filter(p => {
    if (p.price < filters.minPrice || p.price > filters.maxPrice) return false;
    if (p.acreage < filters.minAcreage || p.acreage > filters.maxAcreage) return false;
    if (p.pricePerAcre > filters.maxPricePerAcre) return false;
    if (p.dealScore < filters.minDealScore) return false;
    if (filters.states.length > 0 && !filters.states.includes(p.location.state)) return false;
    if (filters.features.length > 0) {
      const hasAll = filters.features.every(f => p.features.includes(f));
      if (!hasAll) return false;
    }
    if (filters.sources.length > 0 && !filters.sources.includes(p.source)) return false;
    return true;
  });
};

export const useProperties = (filters: FilterState) => {
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Try fetching from data/listings.json first (scraped data),
        // fall back to sample data for development
        let data: Property[];
        try {
          const response = await fetch('./data/listings.json');
          if (!response.ok) throw new Error('No scraped data yet');
          data = await response.json();
        } catch {
          const sampleModule = await import('../data/sample-listings.json');
          data = sampleModule.default as Property[];
        }
        setAllProperties(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load listings');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(
    () => applyFilters(allProperties, filters),
    [allProperties, filters]
  );

  const sorted = useMemo(
    () => [...filtered].sort((a: Property, b: Property) => {
      switch (filters.sortBy) {
        case 'price': return a.price - b.price;
        case 'acreage': return b.acreage - a.acreage;
        case 'title': return a.title.localeCompare(b.title);
        default: return b.dealScore - a.dealScore;
      }
    }),
    [filtered, filters.sortBy]
  );

  const stats = useMemo(() => ({
    total: allProperties.length,
    filtered: filtered.length,
    hotDeals: allProperties.filter(p => p.dealScore >= 80).length,
    avgScore: allProperties.length > 0
      ? Math.round(allProperties.reduce((sum, p) => sum + p.dealScore, 0) / allProperties.length)
      : 0,
  }), [allProperties, filtered]);

  return { properties: sorted, loading, error, stats };
};
