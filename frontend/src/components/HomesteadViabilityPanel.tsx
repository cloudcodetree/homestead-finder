import { useMemo } from 'react';
import { Sprout, Cog, Wheat, Hammer } from 'lucide-react';
import { Property } from '../types/property';
import {
  computeHomesteadViability,
  EnergyFeasibility,
  EnergyOption,
  BuildoutItem,
  GrowingViability,
  LivestockViability,
} from '../utils/homesteadViability';
import { tier, tierClasses, Ring } from './InvestmentScore';

interface HomesteadViabilityPanelProps {
  property: Property;
}

const fmtRange = (lo: number, hi: number): string => {
  const fmt = (v: number) =>
    v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`;
  return `${fmt(lo)}–${fmt(hi)}`;
};

const FEASIBILITY_TONE: Record<EnergyFeasibility, { bg: string; text: string; label: string }> = {
  strong:    { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Strong fit' },
  workable:  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Workable' },
  marginal:  { bg: 'bg-amber-50',   text: 'text-amber-800',   label: 'Marginal' },
  poor:      { bg: 'bg-rose-50',    text: 'text-rose-700',    label: 'Poor fit' },
};

const BAND_VERDICT: Record<GrowingViability['band'], string> = {
  excellent: 'Excellent growing land',
  good:      'Solid for most crops',
  workable:  'Workable with effort',
  limited:   'Limited cropland — better for grazing or timber',
};

/**
 * "What this land can actually do" panel.
 *
 * Surfaces three buckets the user has to think about when buying a
 * homestead but isn't told by the listing:
 *   1. Growing — what crops fit the soil/drainage/slope
 *   2. Livestock — what acreage + features support
 *   3. Energy — solar/wind/hydro/geothermal feasibility + cost
 *   4. Buildout — greenhouse, aquaponics, well, cistern, pond
 *
 * Everything is heuristic. Soil class is real signal; specific cost
 * numbers are within ±50%. Panel is labeled clearly as "estimates"
 * so users don't read precision into it.
 */
export const HomesteadViabilityPanel = ({ property }: HomesteadViabilityPanelProps) => {
  const report = useMemo(() => computeHomesteadViability(property), [property]);
  const { growing, livestock, energy, buildout } = report;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <header className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-1.5">
          <Sprout className="w-4 h-4 text-emerald-700" />
          Homesteading viability
        </h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">
          Heuristic estimates
        </span>
      </header>
      <p className="text-xs text-gray-500">
        What the land can support and what buildout would cost. Numbers are
        rough rules-of-thumb derived from soil class, slope, drainage,
        acreage, and existing features — not engineering quotes. Always
        confirm with local installers and your county extension office.
      </p>

      {/* Growing + Livestock side-by-side score band */}
      <div className="grid sm:grid-cols-2 gap-3">
        <GrowingCard growing={growing} />
        <LivestockCard livestock={livestock} />
      </div>

      {/* Energy options */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-2">
          <Cog className="w-3.5 h-3.5 text-gray-500" />
          Energy systems
        </h4>
        <div className="space-y-1.5">
          {energy.map((opt) => (
            <EnergyRow key={opt.kind} opt={opt} />
          ))}
        </div>
      </div>

      {/* Buildout options */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-2">
          <Hammer className="w-3.5 h-3.5 text-gray-500" />
          Land improvements
        </h4>
        <div className="space-y-1.5">
          {buildout.map((item) => (
            <BuildoutRow key={item.kind} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Sub-cards ────────────────────────────────────────────────────────

const GrowingCard = ({ growing }: { growing: GrowingViability | null }) => {
  if (!growing) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        <p className="font-semibold text-gray-700 mb-0.5 flex items-center gap-1">
          <Wheat className="w-3.5 h-3.5" /> Growing
        </p>
        Soil enrichment pending — run scraper enrich_geo to populate this.
      </div>
    );
  }
  const klass = tierClasses[tier(growing.score)];
  return (
    <div className={`rounded-lg border ${klass.border} ${klass.bg} p-3`}>
      <div className="flex items-center gap-3">
        <Ring score={growing.score} size={48} strokeWidth={5}>
          <Wheat className="w-4 h-4" />
        </Ring>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Growing</p>
          <p className={`text-xs font-medium ${klass.text}`}>
            {BAND_VERDICT[growing.band]}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-600">{growing.rationale}</p>
      {growing.recommendedUses.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {growing.recommendedUses.map((use) => (
            <li key={use} className="text-xs text-gray-700 flex items-baseline gap-1.5">
              <span className="text-emerald-600">•</span>
              {use}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LivestockCard = ({ livestock }: { livestock: LivestockViability | null }) => {
  if (!livestock) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        <p className="font-semibold text-gray-700 mb-0.5 flex items-center gap-1">
          <Sprout className="w-3.5 h-3.5" /> Livestock
        </p>
        Acreage missing — can&rsquo;t estimate carrying capacity.
      </div>
    );
  }
  const klass = tierClasses[tier(livestock.score)];
  return (
    <div className={`rounded-lg border ${klass.border} ${klass.bg} p-3`}>
      <div className="flex items-center gap-3">
        <Ring score={livestock.score} size={48} strokeWidth={5}>
          <Sprout className="w-4 h-4" />
        </Ring>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Livestock</p>
          <p className={`text-xs font-medium ${klass.text}`}>
            {livestock.score >= 75
              ? 'Plenty of room'
              : livestock.score >= 55
                ? 'Workable for small ruminants'
                : 'Tight — small animals only'}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-600">{livestock.rationale}</p>
      {livestock.recommended.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {livestock.recommended.map((rec) => (
            <li key={rec.kind} className="text-xs text-gray-700 flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="text-emerald-600">•</span>
                {rec.kind}
              </span>
              <span className="text-gray-500 tabular-nums whitespace-nowrap">
                {rec.capacity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const EnergyRow = ({ opt }: { opt: EnergyOption }) => {
  const tone = FEASIBILITY_TONE[opt.feasibility];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-900">{opt.label}</span>
          <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${tone.bg} ${tone.text}`}>
            {tone.label}
          </span>
        </div>
        <span className="text-sm font-semibold text-gray-700 tabular-nums">
          {fmtRange(opt.costLowUsd, opt.costHighUsd)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-gray-600">{opt.rationale}</p>
    </div>
  );
};

const BuildoutRow = ({ item }: { item: BuildoutItem }) => {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        item.applicable ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-sm font-medium ${
              item.applicable ? 'text-gray-900' : 'text-gray-500'
            }`}
          >
            {item.label}
          </span>
          {!item.applicable && (
            <span className="rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium px-1.5 py-0">
              n/a
            </span>
          )}
        </div>
        <span
          className={`text-sm font-semibold tabular-nums ${
            item.applicable ? 'text-gray-700' : 'text-gray-400'
          }`}
        >
          {fmtRange(item.costLowUsd, item.costHighUsd)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-gray-600">{item.rationale}</p>
    </div>
  );
};
