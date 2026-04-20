import {
  AITag,
  AI_TAG_LABELS,
  FilterState,
  PropertyFeature,
  FEATURE_LABELS,
  SortBy,
  SORT_LABELS,
} from '../types/property';

interface FilterPanelProps {
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onToggleState: (state: string) => void;
  onToggleFeature: (feature: PropertyFeature) => void;
  onToggleAITag: (tag: AITag) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  resultCount: number;
  /** When true, the panel's built-in header is suppressed (parent renders its own) */
  hideHeader?: boolean;
}

const TARGET_STATES = [
  'AL',
  'AZ',
  'CO',
  'ID',
  'ME',
  'MN',
  'MT',
  'NM',
  'OK',
  'OR',
  'TN',
  'TX',
  'UT',
  'WA',
  'WI',
  'WY',
];

export const FilterPanel = ({
  filters,
  onUpdateFilter,
  onToggleState,
  onToggleFeature,
  onToggleAITag,
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
        {/* Sort By */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SORT_LABELS) as SortBy[]).map(option => (
              <button
                key={option}
                onClick={() => onUpdateFilter('sortBy', option)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  filters.sortBy === option
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {SORT_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        {/* Deal Score */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Deal Score: <span className="text-green-600 font-bold">{filters.minDealScore}</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minDealScore}
            onChange={(e) => onUpdateFilter('minDealScore', Number(e.target.value))}
            className="w-full accent-green-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>

        {/* Price Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Price Range</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Min</label>
              <input
                type="number"
                min={0}
                max={filters.maxPrice}
                step={10000}
                value={filters.minPrice}
                onChange={(e) => onUpdateFilter('minPrice', Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1 focus:ring-1 focus:ring-green-500 focus:outline-none"
                placeholder="$0"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Max</label>
              <input
                type="number"
                min={filters.minPrice}
                step={10000}
                value={filters.maxPrice}
                onChange={(e) => onUpdateFilter('maxPrice', Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-1 focus:ring-1 focus:ring-green-500 focus:outline-none"
                placeholder="$2M"
              />
            </div>
          </div>
        </div>

        {/* Acreage Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Acreage</label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              value={filters.minAcreage}
              onChange={(e) => onUpdateFilter('minAcreage', Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none"
              placeholder="Min acres"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="number"
              min={0}
              value={filters.maxAcreage}
              onChange={(e) => onUpdateFilter('maxAcreage', Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none"
              placeholder="Max acres"
            />
          </div>
        </div>

        {/* Max Price Per Acre */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Price/Acre:{' '}
            <span className="text-green-600">${filters.maxPricePerAcre.toLocaleString()}</span>
          </label>
          <input
            type="range"
            min={100}
            max={10000}
            step={100}
            value={filters.maxPricePerAcre}
            onChange={(e) => onUpdateFilter('maxPricePerAcre', Number(e.target.value))}
            className="w-full accent-green-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>$100</span>
            <span>$5k</span>
            <span>$10k</span>
          </div>
        </div>

        {/* States */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">States</label>
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
              <label key={feature} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.features.includes(feature)}
                  onChange={() => onToggleFeature(feature)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">{FEATURE_LABELS[feature]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* AI Insights */}
        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm font-semibold text-gray-900">AI Insights</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium tracking-wide uppercase">
              Beta
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Filters based on Claude&apos;s analysis of listing descriptions.
          </p>

          {/* Min Homestead Fit */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Min Homestead Fit:{' '}
              <span className="text-purple-600 font-bold">
                {filters.minHomesteadFit}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={filters.minHomesteadFit}
              onChange={(e) =>
                onUpdateFilter('minHomesteadFit', Number(e.target.value))
              }
              className="w-full accent-purple-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
            {filters.minHomesteadFit > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Hides un-analyzed listings.
              </p>
            )}
          </div>

          {/* Hide red flags */}
          <div className="mb-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hideWithRedFlags}
                onChange={(e) =>
                  onUpdateFilter('hideWithRedFlags', e.target.checked)
                }
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700">Hide listings with red flags</span>
            </label>
          </div>

          {/* AI Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Tags (must have all)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(AI_TAG_LABELS) as AITag[]).map((tag) => (
                <button
                  key={tag}
                  onClick={() => onToggleAITag(tag)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    filters.aiTags.includes(tag)
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {AI_TAG_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
