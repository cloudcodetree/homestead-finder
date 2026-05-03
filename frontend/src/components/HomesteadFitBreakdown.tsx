import { Leaf } from 'lucide-react';
import {
  AI_TAG_DESCRIPTIONS,
  AI_TAG_LABELS,
  Property,
  RED_FLAG_DESCRIPTIONS,
  RED_FLAG_LABELS,
  RED_FLAG_SEVERITY,
} from '../types/property';
import { formatDate } from '../utils/formatters';
import { Ring, tier, tierClasses } from './InvestmentScore';

interface HomesteadFitBreakdownProps {
  property: Property;
}

/**
 * Homestead Fit panel — same visual grammar as InvestmentScore + Deal
 * Score panels (Ring + verdict + breakdown), but the "metrics that
 * fed it" are AI-extracted tags and red flags rather than numerical
 * axes. Claude evaluated the listing description against a
 * homesteading lens; the score is a single number, but we surface
 * the qualitative signals it weighed.
 *
 * Renders nothing if the listing hasn't been through the AI
 * enrichment pass — falls through to a small "not analyzed yet" block
 * the parent component owns.
 */
export const HomesteadFitBreakdown = ({ property }: HomesteadFitBreakdownProps) => {
  if (property.homesteadFitScore === undefined || !property.enrichedAt) {
    return null;
  }
  const score = property.homesteadFitScore;
  const klass = tierClasses[tier(score)];

  const verdict =
    score >= 80
      ? 'Strong fit — checks the homesteading boxes'
      : score >= 60
        ? 'Workable fit with caveats'
        : score >= 40
          ? 'Mixed — read the AI breakdown'
          : 'Weak homesteading fit on this signal';

  const tags = property.aiTags ?? [];
  const flags = property.redFlags ?? [];

  return (
    <section
      className={`rounded-xl border ${klass.border} ${klass.bg} p-4`}
      aria-labelledby="fit-score-heading"
    >
      <div className="flex items-center gap-4">
        <Ring score={score} size={80} strokeWidth={8}>
          <Leaf className="w-7 h-7" />
        </Ring>
        <div className="min-w-0 flex-1">
          <h3
            id="fit-score-heading"
            className="flex items-baseline gap-2 text-base font-semibold text-gray-900"
          >
            <Leaf className={`w-4 h-4 ${klass.text}`} aria-hidden="true" />
            Homestead Fit
            <span className={`tabular-nums font-bold ${klass.text}`}>
              {Math.round(score)}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Beta
            </span>
          </h3>
          <p className={`mt-0.5 text-sm font-medium ${klass.text}`}>{verdict}</p>
          <p className="mt-1 text-xs text-gray-600">
            Claude read the listing description and extracted positive
            signals (water, structures, access, zoning) and concerns (red
            flags). The score weighs both — see the chips below for the
            specific signals.
          </p>
        </div>
      </div>

      {property.aiSummary && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Why it scored this way
          </p>
          <p className="text-sm text-gray-700 leading-relaxed italic">
            &ldquo;{property.aiSummary}&rdquo;
          </p>
        </div>
      )}

      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        {/* Strengths column */}
        <div>
          <p className="text-xs font-semibold text-emerald-800 mb-1.5">
            Strengths{' '}
            <span className="font-normal text-emerald-600/70 ml-0.5">
              ({tags.length})
            </span>
          </p>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const desc = AI_TAG_DESCRIPTIONS[tag];
                return (
                  <span
                    key={tag}
                    title={desc || undefined}
                    className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 font-medium cursor-help"
                  >
                    {AI_TAG_LABELS[tag]}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              No positive signals extracted.
            </p>
          )}
        </div>

        {/* Concerns column */}
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-1.5">
            Concerns{' '}
            <span className="font-normal text-amber-600/70 ml-0.5">
              ({flags.length})
            </span>
          </p>
          {flags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {flags.map((flag) => {
                const severity = RED_FLAG_SEVERITY[flag] ?? 3;
                const desc = RED_FLAG_DESCRIPTIONS[flag];
                return (
                  <span
                    key={flag}
                    title={
                      desc ? `${desc} (severity ${severity}/5)` : undefined
                    }
                    className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700 font-medium cursor-help"
                  >
                    {RED_FLAG_LABELS[flag]}
                    <span className="ml-1 text-amber-500">
                      {'•'.repeat(severity)}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">No red flags raised.</p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-gray-400">
        Analyzed {formatDate(property.enrichedAt)} by Claude. Hover any chip
        for the underlying definition.
      </p>
    </section>
  );
};
