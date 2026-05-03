import { X } from 'lucide-react';
import {
  AI_TAG_LABELS,
  AITag,
  DEFAULT_FILTERS,
  FEATURE_LABELS,
  FilterState,
  PropertyFeature,
  US_STATES,
} from '../types/property';
import { formatSourceName } from '../utils/formatters';

interface ChipDef {
  key: string;
  label: string;
  /** Reset just this filter back to its DEFAULT_FILTERS value(s). */
  onClear: () => void;
}

interface ActiveFilterChipsProps {
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onToggleState: (state: string) => void;
  onToggleFeature: (feature: PropertyFeature) => void;
  onToggleAITag: (tag: AITag) => void;
  onToggleListingVariant: (variant: string) => void;
  onToggleSource: (source: string) => void;
}

const fmtPriceShort = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
};

/**
 * Horizontal removable-chip strip showing every filter that's been
 * narrowed off its DEFAULT_FILTERS value. Each chip clears just its
 * own filter — the panel still owns "Clear all". Built so a returning
 * user can see at a glance "I've narrowed by Travis County + a min
 * Investment of 60" without having to re-open the filter panel.
 *
 * Score / range chips render the *narrowed* side(s) only. A bound
 * still at the default extreme (min=0, max=100) doesn't get its own
 * chip — only "Investment ≥ 60" or "Price ≤ $80k" appears.
 */
export const ActiveFilterChips = ({
  filters,
  onUpdateFilter,
  onToggleState,
  onToggleFeature,
  onToggleAITag,
  onToggleListingVariant,
  onToggleSource,
}: ActiveFilterChipsProps) => {
  const chips: ChipDef[] = [];

  const pushScoreRange = (
    name: string,
    minKey: keyof FilterState,
    maxKey: keyof FilterState,
    boundMax: number,
  ) => {
    const min = filters[minKey] as number;
    const max = filters[maxKey] as number;
    const minDefault = DEFAULT_FILTERS[minKey] as number;
    const maxDefault = DEFAULT_FILTERS[maxKey] as number;
    if (min === minDefault && max === maxDefault) return;
    const minOn = min > minDefault;
    const maxOn = max < maxDefault && max < boundMax;
    let label: string;
    if (minOn && maxOn) label = `${name} ${min}–${max}`;
    else if (minOn) label = `${name} ≥ ${min}`;
    else label = `${name} ≤ ${max}`;
    chips.push({
      key: `${minKey}-${maxKey}`,
      label,
      onClear: () => {
        onUpdateFilter(minKey, minDefault as FilterState[typeof minKey]);
        onUpdateFilter(maxKey, maxDefault as FilterState[typeof maxKey]);
      },
    });
  };

  const pushPriceRange = (
    name: string,
    minKey: keyof FilterState,
    maxKey: keyof FilterState,
    boundMax: number,
    fmt: (v: number) => string,
  ) => {
    const min = filters[minKey] as number;
    const max = filters[maxKey] as number;
    const minDefault = DEFAULT_FILTERS[minKey] as number;
    const maxDefault = DEFAULT_FILTERS[maxKey] as number;
    const minOn = min > minDefault;
    const maxOn = max > 0 && max < boundMax;
    if (!minOn && !maxOn) return;
    let label: string;
    if (minOn && maxOn) label = `${name} ${fmt(min)}–${fmt(max)}`;
    else if (minOn) label = `${name} ≥ ${fmt(min)}`;
    else label = `${name} ≤ ${fmt(max)}`;
    chips.push({
      key: `${minKey}-${maxKey}`,
      label,
      onClear: () => {
        onUpdateFilter(minKey, minDefault as FilterState[typeof minKey]);
        onUpdateFilter(maxKey, maxDefault as FilterState[typeof maxKey]);
      },
    });
  };

  pushScoreRange('Deal', 'minDealScore', 'maxDealScore', 100);
  pushScoreRange('Investment', 'minInvestmentScore', 'maxInvestmentScore', 100);
  pushScoreRange('Fit', 'minHomesteadFit', 'maxHomesteadFit', 100);
  pushPriceRange('Price', 'minPrice', 'maxPrice', 250_000, fmtPriceShort);
  pushPriceRange('$/ac', 'minPricePerAcre', 'maxPricePerAcre', 10_000, fmtPriceShort);
  pushPriceRange('Acres', 'minAcreage', 'maxAcreage', 100, (v) => `${v}`);

  filters.states.forEach((s) => {
    chips.push({
      key: `state-${s}`,
      label: US_STATES[s] ?? s,
      onClear: () => onToggleState(s),
    });
  });
  filters.features.forEach((f) => {
    chips.push({
      key: `feature-${f}`,
      label: FEATURE_LABELS[f] ?? f,
      onClear: () => onToggleFeature(f),
    });
  });
  filters.aiTags.forEach((t) => {
    chips.push({
      key: `tag-${t}`,
      label: AI_TAG_LABELS[t] ?? t,
      onClear: () => onToggleAITag(t),
    });
  });
  filters.listingVariants.forEach((v) => {
    chips.push({
      key: `variant-${v}`,
      label: v.replace(/_/g, ' '),
      onClear: () => onToggleListingVariant(v),
    });
  });
  filters.sources.forEach((src) => {
    chips.push({
      key: `source-${src}`,
      label: formatSourceName(src),
      onClear: () => onToggleSource(src),
    });
  });
  if (filters.improvementTier !== 'any') {
    chips.push({
      key: 'tier',
      label: filters.improvementTier.replace(/_/g, ' '),
      onClear: () => onUpdateFilter('improvementTier', 'any'),
    });
  }
  if (filters.hideWithRedFlags) {
    chips.push({
      key: 'redflags',
      label: 'no red flags',
      onClear: () => onUpdateFilter('hideWithRedFlags', false),
    });
  }
  if (filters.searchText && filters.searchText.trim()) {
    chips.push({
      key: 'search',
      label: `"${filters.searchText.trim()}"`,
      onClear: () => onUpdateFilter('searchText', ''),
    });
  }
  if (filters.drawnArea && filters.drawnArea.length >= 3) {
    chips.push({
      key: 'drawn',
      label: 'drawn area',
      onClear: () => onUpdateFilter('drawnArea', null),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={chip.onClear}
          className="group inline-flex items-center gap-1 rounded-full bg-green-50 hover:bg-green-100 border border-green-200 text-green-800 text-xs font-medium px-2 py-0.5 transition-colors"
          title={`Clear: ${chip.label}`}
          aria-label={`Clear filter: ${chip.label}`}
        >
          <span>{chip.label}</span>
          <X className="w-3 h-3 opacity-60 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
};
