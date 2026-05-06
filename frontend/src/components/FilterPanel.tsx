import {
  AITag,
  AI_TAG_LABELS,
  FilterState,
  PropertyFeature,
  FEATURE_LABELS,
  SortBy,
  SORT_LABELS,
} from '../types/property';
import { formatSourceName } from '../utils/formatters';
import { ALL_LISTING_VARIANTS } from '../utils/listingType';
import { DualRangeSlider } from './DualRangeSlider';

interface FilterPanelProps {
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onToggleState: (state: string) => void;
  onToggleFeature: (feature: PropertyFeature) => void;
  onToggleAITag: (tag: AITag) => void;
  onToggleListingVariant: (variant: string) => void;
  onToggleSource: (source: string) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  resultCount: number;
  /** States present in the currently-loaded data. Drives the state filter
   * buttons so they reflect actual inventory instead of a stale hardcoded
   * list. Falls back to a sensible default if empty (e.g. first paint). */
  availableStates?: string[];
  /** Listing-type variants present in the currently-loaded data. Hides
   * filter buttons for categories with zero inventory. */
  availableListingVariants?: string[];
  /** Source → listing-count map, derived from the loaded corpus.
   * Only sources with ≥1 listing are surfaced, and we show the count
   * so the user knows what they're toggling. */
  sourceCounts?: Record<string, number>;
  /** When true, the panel's built-in header is suppressed (parent renders its own) */
  hideHeader?: boolean;
  /** True iff the signed-in user has a fitted personalization model.
   * Controls whether the "Recommended for you" sort pill is shown.
   * Mirror of the same check in Dashboard's sort-select dropdown. */
  hasRankingData?: boolean;
}

// Fallback shown only when `availableStates` is empty (pre-load or total
// scrape failure). Ordered alphabetically so buttons don't reshuffle as
// data loads.
const FALLBACK_STATES = ['AR', 'MO'];

// Compact $/acre display for the Price/Acre slider. The slider's
// upper bound (10,000) is the "no cap" sentinel — we render it as
// "$10k+" so users see at a glance that further values aren't being
// filtered out.
const formatPricePerAcre = (v: number): string => {
  if (v >= 10_000) return '$10k+';
  if (v >= 1_000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${v}`;
};

// Compact total-price display for the Price slider. Top stop
// (250,000) is the "no cap" sentinel rendered as "$250k+".
const formatPrice = (v: number): string => {
  if (v >= 250_000) return '$250k+';
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
};

// Acreage display. Top stop (100) is the "no cap" sentinel rendered
// as "100+".
const formatAcreage = (v: number): string => (v >= 100 ? '100+' : `${v}`);

export const FilterPanel = ({
  filters,
  onUpdateFilter,
  onToggleState,
  onToggleFeature,
  onToggleAITag,
  onToggleListingVariant,
  onToggleSource,
  onReset,
  hasActiveFilters,
  resultCount,
  availableStates,
  availableListingVariants,
  sourceCounts,
  hideHeader = false,
  hasRankingData = false,
}: FilterPanelProps) => {
  // Sorted list of sources present in the loaded data (desc by count so
  // the biggest feeds float to the top of the pill row). Skips zero-count
  // entries so we don't render a button that matches nothing.
  const sourcesToShow = sourceCounts
    ? Object.entries(sourceCounts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([source]) => source)
    : [];
  const statesToShow =
    availableStates && availableStates.length > 0 ? [...availableStates].sort() : FALLBACK_STATES;
  // Only surface variant buttons for categories actually present in
  // the data — hides "Tax Lien" when there are no WY-style parcels,
  // etc. Falls back to all variants during first paint.
  const variantsToShow =
    availableListingVariants && availableListingVariants.length > 0
      ? ALL_LISTING_VARIANTS.filter((v) => availableListingVariants.includes(v.variant))
      : ALL_LISTING_VARIANTS;
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
            {(Object.keys(SORT_LABELS) as SortBy[])
              .filter((option) => option !== 'recommended' || hasRankingData)
              .map((option) => (
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

        {/* Improvement tier — "what I'm shopping for" segmented control.
            Move-in ready = has dwelling + water, ready to occupy.
            Improved = any detected structure/utility, partial lift.
            Bare land = nothing detected, full build-out ahead. */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            I&apos;m looking for…
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['any', 'Any'],
              ['move_in_ready', '🏠 Move-in ready'],
              ['improved', '🔧 Improved'],
              ['bare_land', '🌲 Bare land'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => onUpdateFilter('improvementTier', val)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors border ${
                  filters.improvementTier === val
                    ? 'bg-green-600 border-green-700 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scores & Pricing — autonomy-first ordering. Self-Sufficiency
            (composite + per-axis) is the headline; Deal/Investment/Fit
            move into the "Financial lens" section below. Range sliders
            for Price/$/ac/Acreage stay in their original position
            since those are real constraints, not score opinions. */}
        <div className="space-y-4 pt-2 border-t border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Self-Sufficiency</div>
          <p className="text-xs text-gray-500 -mt-2">
            How close is the parcel to fully autonomous living? Five-axis
            composite — Food, Water, Energy, Shelter, Resilience.
          </p>
          {/* Composite minimum */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Self-Sufficiency:{' '}
              <span className="text-emerald-700 font-bold">
                {filters.minSelfSufficiency || 'no min'}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={filters.minSelfSufficiency}
              onChange={(e) => onUpdateFilter('minSelfSufficiency', Number(e.target.value))}
              className="w-full accent-emerald-600"
            />
          </div>
          {/* Per-axis minimums */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">
              By autonomy axis (minimum)
            </p>
            {(
              [
                ['Food', 'minSsFood'],
                ['Water', 'minSsWater'],
                ['Energy', 'minSsEnergy'],
                ['Shelter', 'minSsShelter'],
                ['Resilience', 'minSsResilience'],
              ] as const
            ).map(([label, key]) => (
              <div key={key}>
                <div className="flex items-center justify-between text-xs text-gray-700 mb-0.5">
                  <span className="font-medium">{label}</span>
                  <span className="text-emerald-700 font-bold tabular-nums">
                    {filters[key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={filters[key]}
                  onChange={(e) => onUpdateFilter(key, Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Financial lens — the legacy buyer-side scores. Demoted to a
            collapsible section so they're available when comparing
            shortlisted parcels but don't crowd the autonomy headline.
            `[&::-webkit-details-marker]:hidden` + `marker:hidden` strip
            the default disclosure triangle so it doesn't eat the first
            character of the summary text in narrow drawers. We add an
            inline chevron in the summary instead. */}
        <details className="pt-2 border-t border-gray-100 group/lens">
          <summary className="text-sm font-semibold text-gray-900 cursor-pointer flex items-center justify-between gap-2 list-none [&::-webkit-details-marker]:hidden marker:hidden py-1">
            <span>Financial lens</span>
            <span className="text-gray-400 text-xs group-open/lens:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="space-y-4 mt-3">
          <p className="text-xs text-gray-500">
            Buyer-side scores. Use these to compare parcels you&rsquo;ve already shortlisted.
          </p>
          <DualRangeSlider
            label="Deal Score"
            min={filters.minDealScore}
            max={filters.maxDealScore}
            bound={{ min: 0, max: 100 }}
            accent="green"
            onChange={(next) => {
              onUpdateFilter('minDealScore', next.min);
              onUpdateFilter('maxDealScore', next.max);
            }}
          />
          <div>
            <DualRangeSlider
              label="Investment Score"
              min={filters.minInvestmentScore}
              max={filters.maxInvestmentScore}
              bound={{ min: 0, max: 100 }}
              accent="emerald"
              onChange={(next) => {
                onUpdateFilter('minInvestmentScore', next.min);
                onUpdateFilter('maxInvestmentScore', next.max);
              }}
            />
            {(filters.minInvestmentScore > 0 || filters.maxInvestmentScore < 100) && (
              <p className="text-xs text-gray-500 mt-1">Hides un-scored listings.</p>
            )}
          </div>
          <div>
            <DualRangeSlider
              label="Homestead Fit"
              min={filters.minHomesteadFit}
              max={filters.maxHomesteadFit}
              bound={{ min: 0, max: 100 }}
              accent="purple"
              onChange={(next) => {
                onUpdateFilter('minHomesteadFit', next.min);
                onUpdateFilter('maxHomesteadFit', next.max);
              }}
            />
            {(filters.minHomesteadFit > 0 || filters.maxHomesteadFit < 100) && (
              <p className="text-xs text-gray-500 mt-1">Hides un-analyzed listings.</p>
            )}
          </div>
          </div>
        </details>

        {/* Pricing & size — single-handle Max sliders. The bound-top
            value acts as the "no max" sentinel: 250k for price, 10k
            for $/ac, 100 for acreage. applyFilters skips the upper-
            bound check at those values so users don't accidentally
            rule out everything. Min counterparts dropped from the UI
            (state still in FilterState as a no-op default). */}
        <div className="space-y-4 pt-2 border-t border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Pricing & size</div>
          <SingleMaxSlider
            label="Max price"
            value={filters.maxPrice}
            min={0}
            max={250_000}
            step={1000}
            format={(v) => (v >= 250_000 ? 'no max' : formatPrice(v))}
            onChange={(v) => onUpdateFilter('maxPrice', v)}
          />
          <SingleMaxSlider
            label="Max $/acre"
            value={filters.maxPricePerAcre}
            min={0}
            max={10_000}
            step={100}
            format={(v) => (v >= 10_000 ? 'no max' : formatPricePerAcre(v))}
            onChange={(v) => onUpdateFilter('maxPricePerAcre', v)}
          />
          {/* Min acreage — "at least N acres" is the natural buyer
              framing for a self-sufficient parcel; max is rarely the
              constraint. 0 = "no min". */}
          <SingleMaxSlider
            label="Min acreage"
            value={filters.minAcreage}
            min={0}
            max={100}
            step={1}
            format={(v) => (v === 0 ? 'no min' : formatAcreage(v))}
            onChange={(v) => onUpdateFilter('minAcreage', v)}
          />
        </div>

        {/* Listing Type — colored pills matching the card accent stripes
            + the map marker outer rings, so the UI tells one consistent
            story across views. */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Listing Type</label>
          <div className="flex flex-wrap gap-1.5">
            {variantsToShow.map((v) => {
              const active = filters.listingVariants.includes(v.variant);
              return (
                <button
                  key={v.variant}
                  onClick={() => onToggleListingVariant(v.variant)}
                  title={v.description}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? `${v.badgePill} ring-2 ring-offset-1 ring-current/40`
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${v.accentBar}`} />
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sources — include-only toggle: no selection = show all;
            clicking a source pill narrows the list to THAT source (and
            any other selected sources). So "ignore HomesteadCrossing"
            = click LandWatch + OzarkLand + County Tax etc. except HC.
            The count on each pill is the full corpus count, not the
            filtered count — helps users calibrate what they'd be
            showing/hiding before committing. */}
        {sourcesToShow.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sources
              {filters.sources.length > 0 ? (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  showing only selected
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  (all shown when none selected)
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {sourcesToShow.map((source) => {
                const active = filters.sources.includes(source);
                const count = sourceCounts?.[source] ?? 0;
                return (
                  <button
                    key={source}
                    onClick={() => onToggleSource(source)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span>{formatSourceName(source)}</span>
                    <span
                      className={`text-[10px] ${active ? 'text-green-100' : 'text-gray-400'}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* States */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">States</label>
          <div className="flex flex-wrap gap-1.5">
            {statesToShow.map((state) => (
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

          {/* Hide red flags */}
          <div className="mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hideWithRedFlags}
                onChange={(e) => onUpdateFilter('hideWithRedFlags', e.target.checked)}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700">Hide listings with red flags</span>
            </label>
          </div>

          {/* Hide inactive (sold / pending / under contract) */}
          <div className="mb-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.hideInactive}
                onChange={(e) => onUpdateFilter('hideInactive', e.target.checked)}
                className="rounded border-gray-300 text-gray-600 focus:ring-gray-500"
              />
              <span className="text-sm text-gray-700">
                Hide sold / pending / under contract
              </span>
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

// ── SingleMaxSlider — one-handle range with header value ─────────────

const SingleMaxSlider = ({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}: <span className="text-emerald-700 font-bold">{format(value)}</span>
    </label>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-emerald-600"
    />
    <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
      <span>{format(min)}</span>
      <span>{format(max)}</span>
    </div>
  </div>
);
