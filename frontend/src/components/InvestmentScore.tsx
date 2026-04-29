import { useState, type ReactNode } from 'react';
import { DollarSign, Info } from 'lucide-react';
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
   * ring is a pure indicator and the consumer puts the number elsewhere
   * (or supplies a child icon via `children`). */
  showNumber?: boolean;
  /** Optional ARIA label override — useful when this ring is used as
   * a generic score indicator (e.g. Homestead Fit, Deal Score) rather
   * than the InvestmentScore composite. */
  ariaLabel?: string;
  /** Custom inner content — typically a small lucide icon at the size
   * the chip wants. Renders centered. Overrides `showNumber`. */
  children?: ReactNode;
}

/**
 * Circular gauge — animated stroke-dasharray. SVG-only, no chart lib.
 * Used by:
 *   - the panel header on detail pages (size=80, showNumber)
 *   - the per-pill badge on cards (size≈22, child glyph instead of
 *     number, see `ScoreRingChip` below)
 * Color follows the same band rules as the per-axis bars so the eye
 * groups them.
 */
const Ring = ({
  score,
  size = 80,
  strokeWidth = 8,
  showNumber = true,
  ariaLabel,
  children,
}: RingProps) => {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const klass = tierClasses[tier(score)];
  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      aria-label={ariaLabel ?? `Score ${Math.round(score)} of 100`}
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
      {children ? (
        <div
          className={`absolute inset-0 flex items-center justify-center ${klass.text}`}
        >
          {children}
        </div>
      ) : (
        showNumber && (
          <div
            className={`absolute inset-0 flex items-center justify-center font-semibold ${klass.text}`}
            style={{ fontSize: size * 0.32 }}
          >
            {Math.round(score)}
          </div>
        )
      )}
    </div>
  );
};

interface ScoreRingChipProps {
  score: number;
  /** Lucide icon component; rendered centered inside the ring. */
  icon: React.ComponentType<{ className?: string }>;
  /** Tooltip / aria — what this score actually measures. */
  label: string;
  /** Override the chip's accent (used by InvestmentScore so the chip
   * matches the panel's tier colors; Fit / Deal use their own palette). */
  toneOverride?: { bg: string; text: string };
}

/**
 * Pill that combines a percentage ring (color-banded by score) with
 * an inner glyph and the score number to its right. Lets the user
 * read identity (icon) AND magnitude (ring fill + color) in one
 * compact chip — the original "icon next to number" version made the
 * three score chips on each card hard to tell apart at small sizes,
 * and the ring-only Investment badge had no identity glyph at all.
 */
export const ScoreRingChip = ({
  score,
  icon: Icon,
  label,
  toneOverride,
}: ScoreRingChipProps) => {
  const klass = tierClasses[tier(score)];
  const tone = toneOverride ?? { bg: klass.bg, text: klass.text };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1 py-0.5 text-xs font-bold ${tone.bg} ${tone.text} border-current/30`}
      title={`${label}: ${Math.round(score)}/100`}
    >
      <Ring
        score={score}
        size={22}
        strokeWidth={2.5}
        ariaLabel={`${label} ${Math.round(score)} of 100`}
      >
        <Icon className="w-3 h-3" />
      </Ring>
      <span className="tabular-nums px-1">{Math.round(score)}</span>
    </span>
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
 * Compact card badge for InvestmentScore — a thin wrapper over the
 * generic `ScoreRingChip` so all three score pills (Investment, Fit,
 * Deal) share the same ring-gauge-with-icon shape. Identity from the
 * DollarSign glyph; magnitude from the ring's stroke fill + tier color.
 */
export const InvestmentScoreBadge = ({ score }: { score: number }) => (
  <ScoreRingChip score={score} icon={DollarSign} label="Investment Score" />
);
