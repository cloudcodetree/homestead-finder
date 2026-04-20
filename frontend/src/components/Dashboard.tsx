import { useState, lazy, Suspense } from 'react';
import { Property, DEFAULT_FILTERS } from '../types/property';
import { PropertyCard } from './PropertyCard';
import { FilterPanel } from './FilterPanel';
import { PropertyDetail } from './PropertyDetail';
import { NotificationSettings } from './NotificationSettings';
import { useProperties } from '../hooks/useProperties';
import { useFilters } from '../hooks/useFilters';
import { getDealScoreColor } from '../utils/scoring';
import { formatPrice, formatAcreage } from '../utils/formatters';

const MapView = lazy(() => import('./MapView').then(m => ({ default: m.MapView })));

type ViewMode = 'list' | 'map';
type SortOption = 'score' | 'fit' | 'price_asc' | 'price_desc' | 'ppa_asc' | 'acreage_desc' | 'newest';

export const Dashboard = () => {
  const { filters, updateFilter, toggleState, toggleFeature, toggleAITag, resetFilters, hasActiveFilters } = useFilters();
  const { properties, loading, error, stats } = useProperties(filters);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilters, setShowFilters] = useState(false); // mobile drawer
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop collapse
  const [sortBy, setSortBy] = useState<SortOption>('score');

  const selectedProperty = selectedId ? properties.find((p: Property) => p.id === selectedId) ?? null : null;

  const activeFilterCount = [
    filters.minPrice !== DEFAULT_FILTERS.minPrice ? 1 : 0,
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice ? 1 : 0,
    filters.minAcreage !== DEFAULT_FILTERS.minAcreage ? 1 : 0,
    filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ? 1 : 0,
    filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ? 1 : 0,
    filters.minDealScore !== DEFAULT_FILTERS.minDealScore ? 1 : 0,
    filters.minHomesteadFit !== DEFAULT_FILTERS.minHomesteadFit ? 1 : 0,
    filters.hideWithRedFlags ? 1 : 0,
    filters.states.length,
    filters.features.length,
    filters.aiTags.length,
    filters.sources.length,
  ].reduce((a, b) => a + b, 0);

  const sortedProperties = [...properties].sort((a: Property, b: Property) => {
    switch (sortBy) {
      case 'fit': return (b.homesteadFitScore ?? -1) - (a.homesteadFitScore ?? -1);
      case 'price_asc': return a.price - b.price;
      case 'price_desc': return b.price - a.price;
      case 'ppa_asc': return a.pricePerAcre - b.pricePerAcre;
      case 'acreage_desc': return b.acreage - a.acreage;
      case 'newest': return new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime();
      default: return b.dealScore - a.dealScore;
    }
  });

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top Nav */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <h1 className="font-bold text-gray-900 text-lg">Homestead Finder</h1>
        </div>

        <div className="hidden sm:flex items-center gap-4 ml-4">
          <div className="text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{stats.total}</span> listings
          </div>
          <div className="text-sm text-gray-500">
            <span className="font-semibold text-green-600">{stats.hotDeals}</span> hot deals
          </div>
          <div className="text-sm text-gray-500">
            Avg score: <span className="font-semibold text-gray-900">{stats.avgScore}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'map' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Map
            </button>
          </div>

          <button
            onClick={() => setShowNotifications(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Notification settings"
          >
            🔔
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop collapsible sidebar */}
        <aside className={`hidden lg:flex flex-col flex-shrink-0 bg-white border-r border-gray-200 overflow-hidden transition-[width] duration-300 ease-in-out ${sidebarOpen ? 'w-72' : 'w-10'}`}>
          {/* Inner container — always w-72 so content clips when collapsed */}
          <div className="w-72 flex flex-col h-full">
            {/* Collapse toggle row — button is left-anchored so it stays visible when collapsed */}
            <div className="flex-shrink-0 flex items-center gap-2 px-2 h-12 border-b border-gray-100">
              <button
                onClick={() => setSidebarOpen(s => !s)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-1 transition-colors"
                title={sidebarOpen ? 'Collapse filters' : 'Expand filters'}
              >
                {sidebarOpen ? '‹' : '›'}
              </button>
              {/* These labels are hidden when collapsed because they exceed the w-10 clip boundary */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </p>
                <p className="text-xs text-gray-500">{properties.length} properties</p>
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
            {/* Scrollable filter body */}
            <div className="flex-1 overflow-y-auto">
              <FilterPanel
                filters={filters}
                onUpdateFilter={updateFilter}
                onToggleState={toggleState}
                onToggleFeature={toggleFeature}
                onToggleAITag={toggleAITag}
                onReset={resetFilters}
                hasActiveFilters={hasActiveFilters}
                resultCount={properties.length}
                hideHeader
              />
            </div>
          </div>
        </aside>

        {/* Mobile filter drawer backdrop */}
        <div
          className={`lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${showFilters ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setShowFilters(false)}
        />

        {/* Mobile filter drawer */}
        <div className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${showFilters ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
              </h2>
              <p className="text-xs text-gray-500">{properties.length} properties</p>
            </div>
            <div className="flex items-center gap-3">
              {hasActiveFilters && (
                <button onClick={resetFilters} className="text-xs text-green-600 hover:text-green-700 font-medium">
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
              onToggleAITag={toggleAITag}
              onReset={resetFilters}
              hasActiveFilters={hasActiveFilters}
              resultCount={properties.length}
              hideHeader
            />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
                <p className="mt-3 text-gray-500 text-sm">Loading listings...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-red-600">
                <p className="text-lg">⚠️ Error loading listings</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && viewMode === 'list' && (
            <div className="h-full overflow-y-auto p-4">
              {/* Sort + count bar */}
              <div className="flex items-center justify-between mb-4 max-w-6xl mx-auto">
                <p className="text-sm text-gray-500">{sortedProperties.length} properties</p>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 hidden sm:block" htmlFor="sort-select">Sort:</label>
                  <select
                    id="sort-select"
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-1 focus:ring-green-500 focus:outline-none"
                  >
                    <option value="score">Best Deal (Score)</option>
                    <option value="fit">Homestead Fit (AI)</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="ppa_asc">Price/Acre: Low to High</option>
                    <option value="acreage_desc">Acreage: Most</option>
                    <option value="newest">Newest First</option>
                  </select>
                </div>
              </div>

              {sortedProperties.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <p className="text-4xl mb-3">🌾</p>
                  <p className="text-gray-600 font-medium">No properties match your filters</p>
                  <button
                    onClick={resetFilters}
                    className="mt-3 text-green-600 hover:text-green-700 text-sm font-medium"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-6xl mx-auto">
                  {sortedProperties.map((property: Property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      onClick={setSelectedId}
                      isSelected={selectedId === property.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {!loading && !error && viewMode === 'map' && (
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Loading map...</p>
              </div>
            }>
              <MapView
                properties={properties}
                selectedId={selectedId}
                onSelectProperty={setSelectedId}
              />
            </Suspense>
          )}
        </main>
      </div>

      {/* Mobile floating Filters button */}
      <button
        onClick={() => setShowFilters(true)}
        className={`lg:hidden fixed bottom-6 left-4 z-30 flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg font-medium text-sm transition-all duration-200 ${showFilters ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>

      {/* Property detail modal */}
      {selectedProperty && (
        <PropertyDetail
          property={selectedProperty}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Notification settings modal */}
      {showNotifications && (
        <NotificationSettings onClose={() => setShowNotifications(false)} />
      )}

      {/* Quick peek bar when map is open and property selected */}
      {viewMode === 'map' && selectedProperty && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex items-center gap-3">
          <div className={`rounded-full w-10 h-10 flex items-center justify-center text-xs font-bold flex-shrink-0 ${getDealScoreColor(selectedProperty.dealScore)}`}>
            {selectedProperty.dealScore}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">{selectedProperty.title}</p>
            <p className="text-xs text-gray-500">
              {formatPrice(selectedProperty.price)} &middot; {formatAcreage(selectedProperty.acreage)}
            </p>
          </div>
          <button
            onClick={() => {/* handled by map popup */}}
            className="text-green-600 text-sm font-medium"
          >
            Details →
          </button>
        </div>
      )}
    </div>
  );
};
