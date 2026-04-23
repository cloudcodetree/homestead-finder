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

  const toggleListingVariant = useCallback((variant: string) => {
    setFilters((prev) => ({
      ...prev,
      listingVariants: prev.listingVariants.includes(variant)
        ? prev.listingVariants.filter((v) => v !== variant)
        : [...prev.listingVariants, variant],
    }));
  }, []);

  const toggleSource = useCallback((source: string) => {
    setFilters((prev) => ({
      ...prev,
      sources: prev.sources.includes(source)
        ? prev.sources.filter((s) => s !== source)
        : [...prev.sources, source],
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  /** Replace the entire filter state at once — used when applying a
   * saved search. Merges missing keys from DEFAULT_FILTERS so a
   * saved-search payload from an older schema doesn't produce NaN
   * range-slider positions or `undefined` array spreads. */
  const replaceFilters = useCallback((incoming: Partial<FilterState>) => {
    setFilters({ ...DEFAULT_FILTERS, ...incoming });
  }, []);

  const hasActiveFilters =
    filters.states.length > 0 ||
    filters.features.length > 0 ||
    filters.aiTags.length > 0 ||
    filters.listingVariants.length > 0 ||
    filters.sources.length > 0 ||
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
    toggleListingVariant,
    toggleSource,
    resetFilters,
    replaceFilters,
    hasActiveFilters,
  };
};
