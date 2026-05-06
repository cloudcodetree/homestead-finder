import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Compass,
  Bookmark,
  CheckCircle,
  Sparkles,
  Wheat,
  Droplet,
  Zap,
  Home,
  Shield,
  ChevronDown,
} from 'lucide-react';
import { useProperties } from '../../hooks/useProperties';
import { DEFAULT_FILTERS, Property } from '../../types/property';
import {
  formatAcreage,
  formatCountyState,
  formatPrice,
  formatPricePerAcre,
} from '../../utils/formatters';
import {
  Axis,
  AxisKey,
  computeSelfSufficiency,
} from '../../utils/selfSufficiency';
import { Ring, tier, tierClasses } from '../InvestmentScore';

// ── Filter state shape for the preview ───────────────────────────────
//
// Single-handle sliders throughout — matches the original "Max Price"
// feel. The headline-extreme value (top of each slider's range) acts
// as the "no cap" sentinel: 100 for scores, $250k for price, $10k for
// $/ac, 100ac for acreage. applyFilters skips the comparison there.
interface PreviewFilters {
  ssMin: number;
  axisMin: Record<AxisKey, number>;
  priceMax: number;
  ppaMax: number;
  acresMax: number;
}

const DEFAULT_PREVIEW_FILTERS: PreviewFilters = {
  ssMin: 0,
  axisMin: { food: 0, water: 0, energy: 0, shelter: 0, resilience: 0 },
  priceMax: 250_000,
  ppaMax: 10_000,
  acresMax: 100,
};

const fmtPriceK = (v: number): string => {
  if (v >= 250_000) return '$250k+';
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
};
const fmtPpa = (v: number): string => {
  if (v >= 10_000) return '$10k+';
  if (v >= 1_000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${v}`;
};
const fmtAcres = (v: number): string => (v >= 100 ? '100+' : `${v}`);

/**
 * Redesigned Browse preview at /preview/redesigned-browse.
 *
 * Three structural shifts vs production Browse:
 *
 *   1. Nav grouping — flat list of 10 routes becomes three
 *      journey-shaped sections: Discover, Shortlist, Decide.
 *
 *   2. Card design — Self-Sufficiency ring replaces Deal Score on
 *      the photo overlay. Below the title, five mini axis bars
 *      (Food/Water/Energy/Shelter/Resilience) make the autonomy
 *      profile glanceable at card scale. Deal/Investment/Fit
 *      collapse into a "financial" footnote.
 *
 *   3. Filter panel — Min Self-Sufficiency is the headline slider;
 *      per-axis mins live below; Deal/Investment/Fit move into a
 *      "Financial lens" expander. Price/$/ac/Acreage stay primary.
 *
 * Same data and routing as production /browse — just different
 * chrome. Sits at /preview/redesigned-browse so the two can be
 * compared side-by-side.
 */
export const RedesignedBrowsePreview = () => {
  const { allProperties, loading } = useProperties(DEFAULT_FILTERS);

  // Compute SS once per property — the cards + filter panel both read
  // from this map. Stable across renders.
  const ssReports = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeSelfSufficiency>>();
    for (const p of allProperties) m.set(p.id, computeSelfSufficiency(p));
    return m;
  }, [allProperties]);

  // Filter state — local to the preview. Production would route
  // through useFilters; this is preview-only with the same dual-ended
  // grammar as the production FilterPanel so all the existing range
  // controls (Price, $/ac, Acreage) feel the same.
  const [filters, setFilters] = useState<PreviewFilters>(DEFAULT_PREVIEW_FILTERS);
  const updateFilter = <K extends keyof PreviewFilters>(
    key: K,
    value: PreviewFilters[K],
  ) => setFilters((f) => ({ ...f, [key]: value }));

  const filtered = useMemo(
    () =>
      allProperties.filter((p) => {
        const ss = ssReports.get(p.id);
        if (!ss) return false;
        // Self-Sufficiency: minimum
        if (ss.composite < filters.ssMin) return false;
        // Per-axis minimums
        for (const axis of ss.axes) {
          if (axis.score < filters.axisMin[axis.key]) return false;
        }
        // Hard ranges — top-of-bound = "no cap" (skip comparison).
        if (filters.priceMax < 250_000 && p.price > filters.priceMax) return false;
        if (filters.ppaMax < 10_000 && p.pricePerAcre > filters.ppaMax) return false;
        if (filters.acresMax < 100 && p.acreage > filters.acresMax) return false;
        return true;
      }),
    [allProperties, ssReports, filters],
  );

  // Sort by Self-Sufficiency descending — headline first.
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (ssReports.get(b.id)?.composite ?? 0) -
          (ssReports.get(a.id)?.composite ?? 0),
      ),
    [filtered, ssReports],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left rail — redesigned nav grouping */}
      <RedesignedNav />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto isolate">
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
          <header className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Browse</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {sorted.length} parcels · sorted by Self-Sufficiency, highest first
              </p>
            </div>
            <Link
              to="/preview/compare"
              className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
            >
              Compare 0 selected →
            </Link>
          </header>

          <div className="grid lg:grid-cols-[280px_1fr] gap-5">
            {/* Filters */}
            <RedesignedFilterPanel filters={filters} updateFilter={updateFilter} />

            {/* Card grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sorted.slice(0, 60).map((p) => (
                <RedesignedCard
                  key={p.id}
                  property={p}
                  report={ssReports.get(p.id)!}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Redesigned nav rail ──────────────────────────────────────────────

interface NavGroup {
  label: string;
  items: Array<{ icon: React.ReactNode; label: string; href: string }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Discover',
    items: [
      { icon: <Search className="w-4 h-4" />, label: 'Browse', href: '/preview/redesigned-browse' },
      { icon: <Compass className="w-4 h-4" />, label: 'Swipe', href: '/swipe' },
      { icon: <Sparkles className="w-4 h-4" />, label: 'Saved searches', href: '/saved-searches' },
    ],
  },
  {
    label: 'Shortlist',
    items: [
      { icon: <Bookmark className="w-4 h-4" />, label: 'Saved', href: '/browse?saved=1' },
      { icon: <CheckCircle className="w-4 h-4" />, label: 'Compare', href: '/preview/compare' },
      { icon: <CheckCircle className="w-4 h-4" />, label: 'Projects', href: '/projects' },
    ],
  },
  {
    label: 'Decide',
    items: [
      { icon: <CheckCircle className="w-4 h-4" />, label: 'Top picks', href: '/home' },
      { icon: <CheckCircle className="w-4 h-4" />, label: 'Homestead deals', href: '/browse' },
      { icon: <CheckCircle className="w-4 h-4" />, label: "Buyer's checklist", href: '#' },
    ],
  },
];

const RedesignedNav = () => (
  <aside className="hidden lg:block w-56 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
    <div className="p-4 space-y-5">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1.5 px-2">
            {g.label}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.label}>
                <Link
                  to={it.href}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                >
                  <span className="text-gray-400">{it.icon}</span>
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </aside>
);

// ── Redesigned filter panel ──────────────────────────────────────────

const AXIS_LABEL: Record<AxisKey, string> = {
  food: 'Food',
  water: 'Water',
  energy: 'Energy',
  shelter: 'Shelter',
  resilience: 'Resilience',
};
const AXIS_NAV_ICON: Record<AxisKey, React.ComponentType<{ className?: string }>> = {
  food: Wheat,
  water: Droplet,
  energy: Zap,
  shelter: Home,
  resilience: Shield,
};

const RedesignedFilterPanel = ({
  filters,
  updateFilter,
}: {
  filters: PreviewFilters;
  updateFilter: <K extends keyof PreviewFilters>(key: K, v: PreviewFilters[K]) => void;
}) => {
  const [showFinancial, setShowFinancial] = useState(false);
  const reset = () => {
    (Object.keys(DEFAULT_PREVIEW_FILTERS) as Array<keyof PreviewFilters>).forEach((k) =>
      updateFilter(k, DEFAULT_PREVIEW_FILTERS[k] as never),
    );
  };
  return (
    <aside className="bg-white border border-gray-200 rounded-xl p-4 space-y-5 self-start lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
        <button
          type="button"
          onClick={reset}
          className="text-[11px] text-emerald-700 hover:text-emerald-900 font-medium"
        >
          Reset
        </button>
      </div>

      {/* Headline: Min Self-Sufficiency — single handle. Same UI feel
          as the Max Price / Max $/ac / Max Acreage sliders below for
          a consistent one-thumb pattern. */}
      <SingleSlider
        label="Min Self-Sufficiency"
        value={filters.ssMin}
        min={0}
        max={100}
        step={5}
        format={(v) => (v === 0 ? 'no min' : `${v}`)}
        onChange={(v) => updateFilter('ssMin', v)}
      />

      {/* Per-axis minimums — single-ended (just minimums) since
          a "max axis score" filter is rarely useful. The headline
          dual covers the upper bound implicitly. */}
      <div>
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-1.5">
          By autonomy axis (minimum)
        </p>
        <div className="space-y-2.5">
          {(Object.keys(AXIS_LABEL) as AxisKey[]).map((key) => {
            const Icon = AXIS_NAV_ICON[key];
            const v = filters.axisMin[key];
            return (
              <div key={key}>
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
                    <Icon className="w-3.5 h-3.5 text-gray-400" />
                    {AXIS_LABEL[key]}
                  </span>
                  <span className="text-xs font-bold text-emerald-700 tabular-nums">{v}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={v}
                  onChange={(e) =>
                    updateFilter('axisMin', { ...filters.axisMin, [key]: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-600"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Hard constraints — single Max sliders matching the original
          "Max Price" UI feel. Top-of-bound value = "no cap". */}
      <SingleSlider
        label="Max price"
        value={filters.priceMax}
        min={0}
        max={250_000}
        step={1000}
        format={(v) => (v >= 250_000 ? 'no max' : fmtPriceK(v))}
        onChange={(v) => updateFilter('priceMax', v)}
      />
      <SingleSlider
        label="Max $/acre"
        value={filters.ppaMax}
        min={0}
        max={10_000}
        step={100}
        format={(v) => (v >= 10_000 ? 'no max' : fmtPpa(v))}
        onChange={(v) => updateFilter('ppaMax', v)}
      />
      <SingleSlider
        label="Max acreage"
        value={filters.acresMax}
        min={0}
        max={100}
        step={1}
        format={(v) => (v >= 100 ? 'no max' : fmtAcres(v))}
        onChange={(v) => updateFilter('acresMax', v)}
      />

      {/* Financial lens — collapsed */}
      <div className="pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={() => setShowFinancial((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
        >
          <ChevronDown
            className={`w-3 h-3 transition-transform ${showFinancial ? 'rotate-180' : ''}`}
          />
          Financial lens
        </button>
        {showFinancial && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-gray-500 italic">
              Buyer-side scores. Use these when comparing parcels
              you&rsquo;ve already shortlisted. (Preview: not wired.)
            </p>
            {['Deal Score', 'Investment Score', 'Homestead Fit'].map((l) => (
              <div key={l} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 flex-shrink-0">{l}</span>
                <input type="range" min={0} max={100} className="flex-1 accent-gray-500" />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

// ── Redesigned card ───────────────────────────────────────────────────

const AXIS_ICON: Record<AxisKey, React.ReactNode> = {
  food: <Wheat className="w-3 h-3" />,
  water: <Droplet className="w-3 h-3" />,
  energy: <Zap className="w-3 h-3" />,
  shelter: <Home className="w-3 h-3" />,
  resilience: <Shield className="w-3 h-3" />,
};

const RedesignedCard = ({
  property,
  report,
}: {
  property: Property;
  report: ReturnType<typeof computeSelfSufficiency>;
}) => {
  const klass = tierClasses[tier(report.composite)];
  return (
    <Link
      to={`/preview/redesigned-detail/${property.id}`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-md transition-all overflow-hidden"
    >
      {/* Photo with SS ring overlay */}
      <div className="relative h-40 bg-gradient-to-br from-emerald-100 via-emerald-50 to-amber-50 flex items-center justify-center">
        <span className="text-3xl">🌿</span>
        <div className="absolute top-2 left-2 rounded-full bg-white shadow px-1 py-1">
          <Ring score={report.composite} size={36} strokeWidth={4}>
            <span className="text-[11px] font-bold">{report.composite}</span>
          </Ring>
        </div>
      </div>

      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 truncate">
          {property.title}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {formatCountyState(property.location.county, property.location.state)} ·{' '}
          {formatAcreage(property.acreage)}
        </p>

        {/* Five mini axis bars — the autonomy profile at card scale */}
        <div className="mt-2 space-y-0.5">
          {report.axes.map((axis) => (
            <MiniAxisBar key={axis.key} axis={axis} />
          ))}
        </div>

        {/* Stats footer */}
        <div className="mt-3 pt-2 border-t border-gray-100 flex items-baseline justify-between">
          <span className="text-base font-bold text-gray-900 tabular-nums">
            {formatPrice(property.price)}
          </span>
          <span className="text-xs text-gray-500 tabular-nums">
            {formatPricePerAcre(property.pricePerAcre)}/ac
          </span>
        </div>

        {/* The one thing to worry about */}
        <p className="mt-1 text-[10px] text-amber-700">
          {report.weakest.label} weakest ({report.weakest.score})
        </p>

        {/* Financial scores collapsed into a tiny footnote */}
        <p className={`mt-1 text-[10px] ${klass.text} italic`}>
          Deal {Math.round(property.dealScore ?? 0)} · Inv{' '}
          {Math.round(property.investmentScore ?? 0)} · Fit{' '}
          {Math.round(property.homesteadFitScore ?? 0)}
        </p>
      </div>
    </Link>
  );
};

// ── SingleSlider — one-handle range with header value ────────────────

const SingleSlider = ({
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
    <label className="block text-xs font-medium text-gray-700 mb-1">
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

const MiniAxisBar = ({ axis }: { axis: Axis }) => {
  const klass = tierClasses[tier(axis.score)];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`flex-shrink-0 ${klass.text}`}>{AXIS_ICON[axis.key]}</span>
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${klass.bar}`}
          style={{ width: `${axis.score}%` }}
        />
      </div>
      <span
        className={`text-[10px] font-bold tabular-nums w-5 text-right ${klass.text}`}
      >
        {axis.score}
      </span>
    </div>
  );
};
