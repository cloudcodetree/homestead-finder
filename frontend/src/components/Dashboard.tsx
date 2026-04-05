import { useState, lazy, Suspense } from 'react';
import { Property } from '../types/property';
import { PropertyCard } from './PropertyCard';
import { FilterPanel } from './FilterPanel';
import { PropertyDetail } from './PropertyDetail';
import { NotificationSettings } from './NotificationSettings';
import { useProperties } from '../hooks/useProperties';
import { useFilters } from '../hooks/useFilters';
import { getDealScoreColor } from '../utils/scoring';
import { formatPrice, formatAcreage } from '../utils/formatters';

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

type ViewMode = 'list' | 'map';

export const Dashboard = () => {
  const { filters, updateFilter, toggleState, toggleFeature, resetFilters, hasActiveFilters } =
    useFilters();
  const { properties, loading, error, stats } = useProperties(filters);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const selectedProperty = selectedId
    ? (properties.find((p: Property) => p.id === selectedId) ?? null)
    : null;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top Nav */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌿</span>
          <h1 className="font-bold text-gray-900 text-lg">Homestead Finder</h1>
        </div>

        {/* Stats bar */}
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
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'map'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Map
            </button>
          </div>

          {/* Mobile filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200"
          >
            Filters {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-green-500" />}
          </button>

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
        {/* Sidebar filters — desktop always visible, mobile via toggle */}
        <aside
          className={`
          ${showFilters ? 'block' : 'hidden'} lg:block
          w-72 flex-shrink-0 overflow-y-auto
          ${showFilters ? 'absolute inset-0 z-40 bg-white' : ''}
        `}
        >
          {showFilters && (
            <div className="lg:hidden sticky top-0 bg-white border-b border-gray-200 p-3 flex justify-end">
              <button
                onClick={() => setShowFilters(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                Close ✕
              </button>
            </div>
          )}
          <FilterPanel
            filters={filters}
            onUpdateFilter={updateFilter}
            onToggleState={toggleState}
            onToggleFeature={toggleFeature}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
            resultCount={properties.length}
          />
        </aside>

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
              {properties.length === 0 ? (
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
                  {properties.map((property: Property) => (
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
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500">Loading map...</p>
                </div>
              }
            >
              <MapView
                properties={properties}
                selectedId={selectedId}
                onSelectProperty={setSelectedId}
              />
            </Suspense>
          )}
        </main>
      </div>

      {/* Property detail modal */}
      {selectedProperty && (
        <PropertyDetail property={selectedProperty} onClose={() => setSelectedId(null)} />
      )}

      {/* Notification settings modal */}
      {showNotifications && <NotificationSettings onClose={() => setShowNotifications(false)} />}

      {/* Quick peek bar when map is open and property selected */}
      {viewMode === 'map' && selectedProperty && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex items-center gap-3">
          <div
            className={`rounded-full w-10 h-10 flex items-center justify-center text-xs font-bold flex-shrink-0 ${getDealScoreColor(selectedProperty.dealScore)}`}
          >
            {selectedProperty.dealScore}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">{selectedProperty.title}</p>
            <p className="text-xs text-gray-500">
              {formatPrice(selectedProperty.price)} &middot;{' '}
              {formatAcreage(selectedProperty.acreage)}
            </p>
          </div>
          <button
            onClick={() => setSelectedId(selectedProperty.id)}
            className="text-green-600 text-sm font-medium"
          >
            Details →
          </button>
        </div>
      )}
    </div>
  );
};
