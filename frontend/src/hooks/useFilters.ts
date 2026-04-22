import { useState, useCallback } from 'react';
import { AITag, FilterState, DEFAULT_FILTERS, PropertyFeature } from '../types/property';

export const useFilters = () => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleState = useCallback((state: string) => {
    setFilters((prev) => ({
      ...prev,
      states: prev.states.includes(state)
        ? prev.states.filter((s) => s !== state)
        : [...prev.states, state],
    }));
  }, []);

  const toggleFeature = useCallback((feature: PropertyFeature) => {
    setFilters((prev) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f) => f !== feature)
        : [...prev.features, feature],
    }));
  }, []);

  const toggleAITag = useCallback((tag: AITag) => {
    setFilters((prev) => ({
      ...prev,
      aiTags: prev.aiTags.includes(tag)
        ? prev.aiTags.filter((t) => t !== tag)
        : [...prev.aiTags, tag],
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters =
    filters.states.length > 0 ||
    filters.features.length > 0 ||
    filters.aiTags.length > 0 ||
    filters.minDealScore > 0 ||
    filters.minHomesteadFit > 0 ||
    filters.hideWithRedFlags ||
    filters.minPrice > DEFAULT_FILTERS.minPrice ||
    filters.maxPrice < DEFAULT_FILTERS.maxPrice ||
    filters.minAcreage > DEFAULT_FILTERS.minAcreage ||
    filters.maxAcreage < DEFAULT_FILTERS.maxAcreage ||
    filters.maxPricePerAcre < DEFAULT_FILTERS.maxPricePerAcre;

  return {
    filters,
    updateFilter,
    toggleState,
    toggleFeature,
    toggleAITag,
    resetFilters,
    hasActiveFilters,
  };
};
