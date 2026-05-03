import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Property } from '../types/property';
import { useCompsCorpus } from '../hooks/useCountyMedians';
import { findBestComps, formatVsComp, rawLandPpa, CompPool } from '../utils/comps';
import { formatAcreage, formatPrice, formatPricePerAcre } from '../utils/formatters';

interface CompBreakdownProps {
  property: Property;
}

const poolTitle = (comp: { pool: CompPool; radiusMi?: number }): string => {
  switch (comp.pool) {
    case 'acreage_band':
      return 'Comparing against similar-acreage parcels in the same county';
    case 'nearby':
      return `Comparing against listings within ${comp.radiusMi ?? 25} miles`;
    case 'county':
      return 'Comparing against the whole county';
  }
};

const POOL_RATIONALE: Record<CompPool, string> = {
  acreage_band:
    "Tightest pool — same county, ±50% of this listing's acreage, AND " +
    'the same improvement tier (bare / improved / move-in-ready). Same ' +
    'buyer pool, similar parcel size, comparable build state.',
  nearby:
    "Used because the county didn't have ≥ 5 similar-acreage comps. " +
    'Radius adapts: starts at 5 miles and expands until we find enough ' +
    'comparables (capped at 100mi).',
  county:
    'Last-resort pool — same county, any acreage. Less precise because ' +
    'a 0.4ac lakefront vs 100ac ranch share a county and not much else.',
};

/**
 * "How we got that number" breakdown for the property detail page.
 * Surfaces three things the user couldn't see otherwise:
 *
 *   1. Which fallback pool we used (and why) — a 25-mile-radius
 *      comparison and a county-wide one give very different signals.
 *   2. The median + this listing's $/ac side by side, with the % delta.
 *   3. Every comp listing that fed the median, sorted by $/ac and
 *      linked, so the user can audit the comparison instead of
 *      trusting an opaque median.
 *
 * Renders nothing if no pool clears the comp threshold — the card
 * already shows "no comps" in that case, so a panel here would just
 * repeat that.
 */
export const CompBreakdown = ({ property }: CompBreakdownProps) => {
  const corpus = useCompsCorpus();
  const comp = useMemo(() => findBestComps(property, corpus), [property, corpus]);
  const [expanded, setExpanded] = useState(false);

  if (!comp) return null;

  // Both sides of the comparison run on raw-land $/ac (asking $/ac
  // minus the value of any structures + utility improvements). The
  // subject's `residualPricePerAcre` is the same number scoring
  // already uses; comps' medians are computed on the same basis.
  const subjRawPpa = rawLandPpa(property);
  const subjAskingPpa = property.pricePerAcre;
  const structuresUsd = property.estimatedStructureValueUsd ?? 0;
  const hasStructureAdjustment = structuresUsd > 0 && subjRawPpa !== subjAskingPpa;
  const vsLabel = formatVsComp(subjRawPpa, comp);
  const delta =
    comp.median > 0 ? Math.round(((subjRawPpa - comp.median) / comp.median) * 100) : 0;
  const deltaTone =
    delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-orange-700' : 'text-gray-600';

  // Show first 8 comps inline, the rest behind an expand toggle. 8 is
  // typically enough to spot whether the median is being pulled by a
  // few outliers without making the panel scroll forever.
  const FIRST_BATCH = 8;
  const visible = expanded ? comp.comps : comp.comps.slice(0, FIRST_BATCH);
  const hiddenCount = comp.comps.length - visible.length;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <header className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-gray-900 text-sm">
          How we computed the comp
        </h3>
        <span className="text-xs text-gray-400">
          raw-land basis
        </span>
      </header>

      <p className="text-sm text-gray-700">{poolTitle(comp)}</p>
      <p className="text-xs text-gray-500 mt-0.5">{POOL_RATIONALE[comp.pool]}</p>

      {/* Subject's structure-subtraction breakdown — only shown when we
          actually netted out something. Tells the user how we got from
          asking $/ac to raw-land $/ac. */}
      {hasStructureAdjustment ? (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <p className="font-medium text-gray-700 mb-1">This listing, normalized to raw land:</p>
          <div className="flex items-center gap-1.5 text-gray-700 tabular-nums flex-wrap">
            <span>Asking <strong>{formatPricePerAcre(subjAskingPpa)}</strong></span>
            <span className="text-gray-400">−</span>
            <span title="Sum of detected structures + utility improvements">
              {formatPrice(structuresUsd)} of structures &amp; utilities
            </span>
            <span className="text-gray-400">÷</span>
            <span>{formatAcreage(property.acreage)}</span>
            <span className="text-gray-400">=</span>
            <span className="font-semibold text-gray-900">
              {formatPricePerAcre(subjRawPpa)}/ac raw
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          This listing has no detected structures or utility improvements,
          so raw-land $/ac equals asking $/ac
          ({formatPricePerAcre(subjAskingPpa)}).
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-gray-50 border border-gray-100 py-2">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">Comps</p>
          <p className="text-base font-semibold text-gray-900 tabular-nums">
            {comp.count}
          </p>
        </div>
        <div className="rounded bg-gray-50 border border-gray-100 py-2">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">Median $/ac</p>
          <p className="text-base font-semibold text-gray-900 tabular-nums">
            {formatPricePerAcre(comp.median)}
          </p>
        </div>
        <div className="rounded bg-gray-50 border border-gray-100 py-2">
          <p className="text-[11px] text-gray-500 uppercase tracking-wide">vs comps</p>
          <p className={`text-base font-semibold tabular-nums ${deltaTone}`}>
            {delta > 0 ? '+' : ''}
            {delta}%
          </p>
        </div>
      </div>

      {comp.acreageBand && (
        <p className="mt-2 text-[11px] text-gray-500">
          Acreage band: {formatAcreage(comp.acreageBand.lo)} – {formatAcreage(comp.acreageBand.hi)} (±50% of this listing&rsquo;s {formatAcreage(property.acreage)})
        </p>
      )}
      {comp.radiusMi && (
        <p className="mt-2 text-[11px] text-gray-500">
          Search radius: {comp.radiusMi} miles by lat/lng
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500 mb-1.5">
          Comp listings, raw-land $/ac (sorted cheapest → priciest)
        </p>
        <ul className="space-y-1">
          {visible.map((p) => {
            const compRawPpa = rawLandPpa(p);
            const compAskingPpa = p.pricePerAcre;
            const compHasAdj =
              compAskingPpa > 0 && Math.abs(compRawPpa - compAskingPpa) > 1;
            const compDelta =
              subjRawPpa > 0
                ? Math.round(((compRawPpa - subjRawPpa) / subjRawPpa) * 100)
                : 0;
            return (
              <li key={p.id} className="flex items-center justify-between text-xs gap-2">
                <Link
                  to={`/p/${encodeURIComponent(p.id)}`}
                  className="truncate text-gray-700 hover:text-green-700 hover:underline flex-1 min-w-0"
                  title={
                    compHasAdj
                      ? `Asking ${formatPricePerAcre(compAskingPpa)}/ac → raw ${formatPricePerAcre(compRawPpa)}/ac after subtracting structures`
                      : p.title
                  }
                >
                  <span className="text-gray-400 mr-1.5 tabular-nums">
                    {formatAcreage(p.acreage)}
                  </span>
                  {p.title}
                </Link>
                <span className="text-gray-700 flex-shrink-0 tabular-nums">
                  {formatPricePerAcre(compRawPpa)}
                  {compHasAdj && (
                    <span className="ml-1 text-[10px] text-gray-400">
                      (asking {formatPricePerAcre(compAskingPpa)})
                    </span>
                  )}
                  {subjRawPpa > 0 && (
                    <span
                      className={`ml-1.5 text-[10px] font-medium ${
                        compDelta < 0
                          ? 'text-emerald-600'
                          : compDelta > 0
                            ? 'text-orange-600'
                            : 'text-gray-400'
                      }`}
                    >
                      ({compDelta >= 0 ? '+' : ''}
                      {compDelta}%)
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 text-xs text-green-700 hover:text-green-800 font-medium"
          >
            Show {hiddenCount} more comp{hiddenCount === 1 ? '' : 's'}
          </button>
        )}
        {expanded && comp.comps.length > FIRST_BATCH && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            Show fewer
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px] text-gray-400 leading-snug">
        {vsLabel ? `${vsLabel}. ` : ''}
        All numbers are <strong>raw-land $/ac</strong>: asking price
        minus the estimated value of any detected structures + utility
        improvements (well, septic, electric, dwelling), divided by
        acreage. Both sides of the comparison are normalized this way so
        a bare 10ac and a 10ac with cabin can be compared on the
        underlying land value alone. Medians use current asking
        inventory only — sold and pending rows excluded. We don&rsquo;t
        have closed-sale data, so this is &ldquo;what similar raw land
        is listed at right now,&rdquo; not an appraisal.
      </p>
    </section>
  );
};
