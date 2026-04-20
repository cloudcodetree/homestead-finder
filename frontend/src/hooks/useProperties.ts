import { useState, useEffect, useMemo } from 'react';
import { Property, FilterState } from '../types/property';

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
          const response = await fetch(`${import.meta.env.BASE_URL}data/listings.json`);
          if (!response.ok) throw new Error('No scraped data yet');
          const fetched = await response.json() as Property[];
          // listings.json is [] when scraper hasn't found any results yet
          if (fetched.length === 0) throw new Error('No scraped data yet');
          data = fetched;
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

  const filtered = useMemo(() => applyFilters(allProperties, filters), [allProperties, filters]);

  const sorted = useMemo(
    () => [...filtered].sort((a: Property, b: Property) => {
      switch (filters.sortBy) {
        case 'price': return a.price - b.price;
        case 'pricePerAcre': return a.pricePerAcre - b.pricePerAcre;
        case 'acreage': return b.acreage - a.acreage;
        case 'dateFound': return new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime();
        case 'title': return a.title.localeCompare(b.title);
        case 'homesteadFit': return (b.homesteadFitScore ?? -1) - (a.homesteadFitScore ?? -1);
        default: return b.dealScore - a.dealScore;
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
              allProperties.reduce((sum, p) => sum + p.dealScore, 0) / allProperties.length
            )
          : 0,
    }),
    [allProperties, filtered]
  );

  return { properties: sorted, loading, error, stats };
};
