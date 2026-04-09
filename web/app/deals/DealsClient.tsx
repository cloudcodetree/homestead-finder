'use client';

import { useState, useMemo } from 'react';
import type {
  Property,
  FilterState,
  PropertyFeature,
  SortOption,
} from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';
import { PropertyCard } from '@/components/PropertyCard';
import { FilterPanel } from '@/components/FilterPanel';
import { applyFilters } from '@/lib/filters';

interface DealsClientProps {
  allListings: Property[];
}

export function DealsClient({ allListings }: DealsClientProps) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFilters, setShowFilters] = useState(false); // mobile drawer
  const [sortBy, setSortBy] = useState<SortOption>('score');

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleState = (state: string) => {
    setFilters((prev) => ({
      ...prev,
      states: prev.states.includes(state)
        ? prev.states.filter((s) => s !== state)
        : [...prev.states, state],
    }));
  };

  const toggleFeature = (feature: PropertyFeature) => {
    setFilters((prev) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f) => f !== feature)
        : [...prev.features, feature],
    }));
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // Cheap boolean — no useMemo needed
  // (react-best-practices: rerender-simple-expression-in-memo)
  const hasActiveFilters =
    filters.minPrice !== DEFAULT_FILTERS.minPrice ||
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice ||
    filters.minAcreage !== DEFAULT_FILTERS.minAcreage ||
    filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ||
    filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ||
    filters.minDealScore !== DEFAULT_FILTERS.minDealScore ||
    filters.states.length > 0 ||
    filters.features.length > 0 ||
    filters.sources.length > 0;

  const activeFilterCount =
    (filters.minPrice !== DEFAULT_FILTERS.minPrice ? 1 : 0) +
    (filters.maxPrice !== DEFAULT_FILTERS.maxPrice ? 1 : 0) +
    (filters.minAcreage !== DEFAULT_FILTERS.minAcreage ? 1 : 0) +
    (filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ? 1 : 0) +
    (filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ? 1 : 0) +
    (filters.minDealScore !== DEFAULT_FILTERS.minDealScore ? 1 : 0) +
    filters.states.length +
    filters.features.length +
    filters.sources.length;

  // Filter is O(n) — cache with useMemo
  const filtered = useMemo(
    () => applyFilters(allListings, filters),
    [allListings, filters],
  );

  // Sort is O(n log n) — cache with useMemo, depends on sortBy + filtered
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        switch (sortBy) {
          case 'price_asc':
            return a.price - b.price;
          case 'price_desc':
            return b.price - a.price;
          case 'ppa_asc':
            return a.pricePerAcre - b.pricePerAcre;
          case 'acreage_desc':
            return b.acreage - a.acreage;
          case 'newest':
            return (
              new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime()
            );
          case 'score':
          default:
            return b.dealScore - a.dealScore;
        }
      }),
    [filtered, sortBy],
  );

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Desktop collapsible sidebar */}
      <aside
        className={`hidden lg:flex flex-col flex-shrink-0 bg-white border-r border-gray-200 overflow-hidden transition-[width] duration-300 ease-in-out ${
          sidebarOpen ? 'w-72' : 'w-10'
        }`}
      >
        <div className="w-72 flex flex-col h-full">
          <div className="flex-shrink-0 flex items-center gap-2 px-2 h-12 border-b border-gray-100">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-1 transition-colors"
              title={sidebarOpen ? 'Collapse filters' : 'Expand filters'}
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                Filters
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </p>
              <p className="text-xs text-gray-500">
                {sorted.length} properties
              </p>
            </div>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="flex-shrink-0 text-xs text-green-600 hover:text-green-700 font-medium"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <FilterPanel
              filters={filters}
              onUpdateFilter={updateFilter}
              onToggleState={toggleState}
              onToggleFeature={toggleFeature}
              onReset={resetFilters}
              hasActiveFilters={hasActiveFilters}
              resultCount={sorted.length}
              hideHeader
            />
          </div>
        </div>
      </aside>

      {/* Mobile drawer backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          showFilters ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setShowFilters(false)}
      />

      {/* Mobile drawer */}
      <div
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          showFilters ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">
              Filters
              {activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
            </h2>
            <p className="text-xs text-gray-500">{sorted.length} properties</p>
          </div>
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="text-xs text-green-600 hover:text-green-700 font-medium"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setShowFilters(false)}
              className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FilterPanel
            filters={filters}
            onUpdateFilter={updateFilter}
            onToggleState={toggleState}
            onToggleFeature={toggleFeature}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
            resultCount={sorted.length}
            hideHeader
          />
        </div>
      </div>

      {/* Main content */}
      <section className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4 max-w-6xl mx-auto">
            <p className="text-sm text-gray-500">
              {sorted.length} properties
            </p>
            <div className="flex items-center gap-2">
              <label
                className="text-sm text-gray-600 hidden sm:block"
                htmlFor="sort-select"
              >
                Sort:
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-1 focus:ring-green-500 focus:outline-none"
              >
                <option value="score">Best Deal (Score)</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="ppa_asc">Price/Acre: Low to High</option>
                <option value="acreage_desc">Acreage: Most</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-4xl mb-3">🌾</p>
              <p className="text-gray-600 font-medium">
                No properties match your filters
              </p>
              <button
                onClick={resetFilters}
                className="mt-3 text-green-600 hover:text-green-700 text-sm font-medium"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-6xl mx-auto">
              {sorted.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Mobile FAB */}
      <button
        onClick={() => setShowFilters(true)}
        className={`lg:hidden fixed bottom-6 left-4 z-30 flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg font-medium text-sm transition-all duration-200 ${
          showFilters ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>
    </div>
  );
}
