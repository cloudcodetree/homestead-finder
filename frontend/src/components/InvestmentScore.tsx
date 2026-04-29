import { useState } from 'react';
import { Info } from 'lucide-react';
import type {
  InvestmentAxis,
  InvestmentBreakdown,
  Property,
} from '../types/property';

/**
 * Map a 0-100 score to a Tailwind palette tier. Used by both the
 * ring gauge stroke + the per-axis bars. Three bands keep the visual
 * legible at-a-glance: red = avoid, amber = caveat, green = solid.
 *
 * Thresholds are conservative on purpose — a 60 score is "okay" not
 * "great", because users glancing at a card should only see green
 * for genuinely strong properties.
 */
const tier = (score: number) => {
  if (score >= 70) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
};

const tierClasses: Record<
  'green' | 'amber' | 'red',
  { bar: string; text: string; ring: string; bg: string }
> = {
  green: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
    ring: 'stroke-emerald-500',
    bg: 'bg-emerald-50',
  },
  amber: {
    bar: 'bg-amber-500',
    text: 'text-amber-700',
    ring: 'stroke-amber-500',
    bg: 'bg-amber-50',
  },
  red: {
    bar: 'bg-rose-500',
    text: 'text-rose-700',
    ring: 'stroke-rose-500',
    bg: 'bg-rose-50',
  },
};

interface RingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  /** When true, the score number sits inside the ring; when false the
   * ring is a pure indicator and the consumer puts the number elsewhere. */
  showNumber?: boolean;
}

/**
 * Circular gauge — animated stroke-dasharray. SVG-only, no chart lib.
 * Used by the badge on cards (size=44) and the panel header on detail
 * pages (size=80). Color follows the same band rules as the per-axis
 * bars so the eye groups them.
 */
const Ring = ({ score, size = 80, strokeWidth = 8, showNumber = true }: RingProps) => {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const klass = tierClasses[tier(score)];
  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      aria-label={`Investment score ${Math.round(score)} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90 transform">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          className="fill-transparent stroke-gray-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={`fill-transparent ${klass.ring} transition-[stroke-dashoffset] duration-500`}
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      {showNumber && (
        <div
          className={`absolute inset-0 flex items-center justify-center font-semibold ${klass.text}`}
          style={{ fontSize: size * 0.32 }}
        >
          {Math.round(score)}
        </div>
      )}
    </div>
  );
};

/**
 * One axis row in the breakdown panel — label, bar, score number, and
 * an expandable signals list (the "show your work" tooltip). The bar
 * width is the score / 100 and the bar color follows the same tier
 * thresholds as the ring.
 *
 * Disabled axes (weight = 0 — typically because the underlying data
 * isn't enriched yet, e.g. no `geoEnrichment` for the Land axis) render
 * grayed-out with a "data pending" affordance instead of a misleading
 * neutral 50.
 */
const AxisRow = ({ axis }: { axis: InvestmentAxis }) => {
  const [open, setOpen] = useState(false);
  const disabled = axis.weight === 0;
  const klass = tierClasses[tier(axis.score)];
  const widthPct = Math.max(0, Math.min(100, axis.score));
  const hasSignals = (axis.signals?.length ?? 0) > 0;
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        disabled ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`text-sm font-medium flex-shrink-0 w-20 ${
            disabled ? 'text-gray-400' : 'text-gray-700'
          }`}
        >
          {axis.label}
        </span>
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-[width] duration-500 ${
              disabled ? 'bg-gray-300' : klass.bar
            }`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <span
          className={`text-sm font-semibold tabular-nums w-9 text-right ${
            disabled ? 'text-gray-400' : klass.text
          }`}
        >
          {Math.round(axis.score)}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums w-10 text-right">
          {disabled ? '—' : `×${axis.weight.toFixed(2)}`}
        </span>
        {hasSignals && (
          <button
            type="button"
            aria-label={`Show ${axis.label} details`}
            onClick={() => setOpen((v) => !v)}
            className="text-gray-400 hover:text-gray-700"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && hasSignals && (
        <ul className="mt-2 ml-22 space-y-0.5 text-xs text-gray-600">
          {axis.signals!.map((sig, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{sig.label}</span>
              <span className="tabular-nums text-gray-500 flex-shrink-0">
                {sig.value ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface PanelProps {
  property: Property;
}

/**
 * Full InvestmentScore panel for the detail page. Shows the composite
 * ring gauge, a one-line summary of what the score means, and the
 * five per-axis bars below. Rendered alongside the AI Analysis +
 * Market Context panels.
 *
 * Renders nothing if `investmentBreakdown` is missing (older listings
 * before this enrichment pass). The composite `investmentScore` alone
 * is not enough — without the breakdown the visual rule (always show
 * the breakdown, never just a number) doesn't hold.
 */
export const InvestmentScorePanel = ({ property }: PanelProps) => {
  const breakdown: InvestmentBreakdown | undefined = property.investmentBreakdown;
  if (!breakdown) return null;
  const klass = tierClasses[tier(breakdown.score)];

  // Headline copy — descriptive, not just adjectival.
  const verdict =
    breakdown.score >= 75
      ? 'Strong investment fundamentals'
      : breakdown.score >= 60
        ? 'Solid investment with caveats'
        : breakdown.score >= 45
          ? 'Mixed — read the breakdown'
          : 'Weak fundamentals';

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-4"
      aria-labelledby="invest-score-heading"
    >
      <div className="flex items-center gap-4">
        <Ring score={breakdown.score} size={80} strokeWidth={8} />
        <div className="min-w-0 flex-1">
          <h3
            id="invest-score-heading"
            className="flex items-baseline gap-2 text-base font-semibold text-gray-900"
          >
            Investment Score
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Beta
            </span>
          </h3>
          <p className={`mt-0.5 text-sm font-medium ${klass.text}`}>{verdict}</p>
          <p className="mt-1 text-xs text-gray-500">
            Composite of value vs comps, physical land quality, downside
            risk, market liquidity, and county macro signals. Tap each
            row's <Info className="inline w-3 h-3" /> to see what fed it.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {breakdown.axes.map((axis) => (
          <AxisRow key={axis.key} axis={axis} />
        ))}
      </div>
    </section>
  );
};

/**
 * Compact badge for cards — just the ring gauge + score number.
 * The ring IS the icon: it's the only chip on the card with a
 * filled circular gauge, so it's immediately distinguishable from
 * the homestead-fit (sprout) and deal-score (sparkles) chips that
 * sit next to it. The "Inv" text label was redundant — the tooltip
 * carries the full meaning.
 */
export const InvestmentScoreBadge = ({ score }: { score: number }) => {
  const klass = tierClasses[tier(score)];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-bold ${klass.bg} ${klass.text} border-current/30`}
      title={`Investment Score: ${Math.round(score)} / 100`}
    >
      <Ring score={score} size={18} strokeWidth={3} showNumber={false} />
      <span className="tabular-nums">{Math.round(score)}</span>
    </span>
  );
};
