'use client';

import type { FilterState, PropertyFeature } from '@/types/property';
import { FEATURE_LABELS } from '@/types/property';

interface FilterPanelProps {
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => void;
  onToggleState: (state: string) => void;
  onToggleFeature: (feature: PropertyFeature) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  resultCount: number;
  /** When true, the panel's built-in header is suppressed so the parent can render its own */
  hideHeader?: boolean;
}

const TARGET_STATES = [
  'AL', 'AZ', 'CO', 'ID', 'ME', 'MN', 'MT', 'NM',
  'OK', 'OR', 'TN', 'TX', 'UT', 'WA', 'WI', 'WY',
];

export const FilterPanel = ({
  filters,
  onUpdateFilter,
  onToggleState,
  onToggleFeature,
  onReset,
  hasActiveFilters,
  resultCount,
  hideHeader = false,
}: FilterPanelProps) => {
  return (
    <div className="bg-white h-full">
      {!hideHeader && (
        <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-semibold text-gray-900">Filters</h2>
            <p className="text-xs text-gray-500">{resultCount} properties</p>
          </div>
          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="text-xs text-green-600 hover:text-green-700 font-medium"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="p-4 space-y-6">
        {/* Deal Score */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Deal Score:{' '}
            <span className="text-green-600 font-bold">
              {filters.minDealScore}
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minDealScore}
            onChange={(e) =>
              onUpdateFilter('minDealScore', Number(e.target.value))
            }
            className="w-full accent-green-600"
          />
        </div>

        {/* Price Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Price Range
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={filters.minPrice}
              onChange={(e) =>
                onUpdateFilter('minPrice', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Min"
            />
            <input
              type="number"
              min={filters.minPrice}
              value={filters.maxPrice}
              onChange={(e) =>
                onUpdateFilter('maxPrice', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Max"
            />
          </div>
        </div>

        {/* Acreage */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Acreage
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              value={filters.minAcreage}
              onChange={(e) =>
                onUpdateFilter('minAcreage', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Min"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="number"
              min={0}
              value={filters.maxAcreage}
              onChange={(e) =>
                onUpdateFilter('maxAcreage', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Max"
            />
          </div>
        </div>

        {/* States */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            States
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TARGET_STATES.map((state) => (
              <button
                key={state}
                onClick={() => onToggleState(state)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  filters.states.includes(state)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {state}
              </button>
            ))}
          </div>
        </div>

        {/* Features */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Features (must have all)
          </label>
          <div className="space-y-1.5">
            {(Object.keys(FEATURE_LABELS) as PropertyFeature[]).map((feature) => (
              <label
                key={feature}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.features.includes(feature)}
                  onChange={() => onToggleFeature(feature)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">
                  {FEATURE_LABELS[feature]}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
