import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { Property } from '../types/property';
import {
  computeDealScoreBreakdown,
  DealAxis,
} from '../utils/dealScoreBreakdown';
import { findBestComps } from '../utils/comps';
import { useCompsCorpus } from '../hooks/useCountyMedians';
import { Ring, tier, tierClasses } from './InvestmentScore';

interface DealScoreBreakdownProps {
  property: Property;
}

/**
 * Per-axis row, mirroring InvestmentScore's AxisRow but with the
 * absolute earned/max points (4-axis composite uses different
 * weights, so showing "12 / 40 pts" is more honest than a 0–100
 * derived bar). The bar still uses the 0–100-normalized score so
 * visual fill stays comparable across panels.
 */
const Row = ({ axis }: { axis: DealAxis }) => {
  const klass = tierClasses[tier(axis.scoreOutOf100)];
  const widthPct = Math.max(0, Math.min(100, axis.scoreOutOf100));
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 flex-shrink-0 w-32">
          {axis.label}
        </span>
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-[width] duration-500 ${klass.bar}`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <span
          className={`text-sm font-semibold tabular-nums w-14 text-right ${klass.text}`}
        >
          {axis.earned} / {axis.maxPoints}
        </span>
      </div>
      <p className="mt-1 ml-32 text-xs text-gray-500">{axis.rationale}</p>
    </div>
  );
};

/**
 * Deal Score breakdown — same visual grammar as the Investment panel,
 * but green-keyed (Star icon) and using the four-axis composite the
 * scraper actually computes (Price 40 + Features 30 + DOM 20 + Source 10).
 *
 * Renders client-side from the loaded `Property` so we don't need a
 * scraper change to surface the breakdown — the formula in
 * `utils/dealScoreBreakdown.ts` mirrors `scraper/scoring.py`.
 */
export const DealScoreBreakdown = ({ property }: DealScoreBreakdownProps) => {
  const stored = property.dealScore;
  if (stored === undefined || stored === null) return null;
  // Re-anchor the Price axis against the same nearby-comp median the
  // CompBreakdown panel shows so both panels tell a consistent story.
  // When no comp pool is available we fall through to the static
  // state median (matches the scraper's stored dealScore).
  const corpus = useCompsCorpus();
  const comp = useMemo(() => findBestComps(property, corpus), [property, corpus]);
  const priceAnchor = comp
    ? {
        median: comp.median,
        scope:
          comp.pool === 'acreage_band'
            ? 'similar lots'
            : comp.pool === 'nearby'
              ? `${comp.radiusMi ?? 25}mi comps`
              : 'county comps',
      }
    : undefined;
  const axes = computeDealScoreBreakdown(property, { priceAnchor });
  // Sum of earned points = the "live" score that matches the bars.
  // Shown as the headline so a green-banded panel always means
  // green-banded bars, not the scraper's stale anchor value.
  const score = axes.reduce((s, a) => s + a.earned, 0);
  const klass = tierClasses[tier(score)];

  const verdict =
    score >= 80
      ? 'Hot deal — multiple levers in your favor'
      : score >= 65
        ? 'Solid deal — at least two levers working'
        : score >= 50
          ? 'Fair — read the breakdown'
          : 'Below average — limited upside on these signals';

  return (
    <section
      className={`rounded-xl border ${klass.border} ${klass.bg} p-4`}
      aria-labelledby="deal-score-heading"
    >
      <div className="flex items-center gap-4">
        <Ring score={score} size={80} strokeWidth={8}>
          <Star className="w-7 h-7" />
        </Ring>
        <div className="min-w-0 flex-1">
          <h3
            id="deal-score-heading"
            className="flex items-baseline gap-2 text-base font-semibold text-gray-900"
          >
            <Star className={`w-4 h-4 ${klass.text}`} aria-hidden="true" />
            Deal Score
            <span className={`tabular-nums font-bold ${klass.text}`}>
              {Math.round(score)}
            </span>
          </h3>
          <p className={`mt-0.5 text-sm font-medium ${klass.text}`}>{verdict}</p>
          <p className="mt-1 text-xs text-gray-600">
            Composite of four signals: how the asking price compares to{' '}
            {priceAnchor ? 'nearby comps' : 'the regional median'}, what
            homesteading features the listing has, how long it&rsquo;s been
            on market (negotiating leverage), and how motivated the source
            typically is.
            {priceAnchor && score !== stored && (
              <>
                {' '}
                Originally scored {stored}/100 against the state median; the
                panel re-anchors against the tighter local pool from the comp
                breakdown below.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {axes.map((axis) => (
          <Row key={axis.key} axis={axis} />
        ))}
      </div>
    </section>
  );
};
