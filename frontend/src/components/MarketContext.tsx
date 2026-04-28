import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProperties } from '../hooks/useProperties';
import { DEFAULT_FILTERS, Property, VotingPattern } from '../types/property';
import { formatPricePerAcre } from '../utils/formatters';
import { computeMarketStats } from '../utils/marketStats';

/**
 * Pretty-print the county voting bucket. Kept terse — it's a chip,
 * not a sentence. Year goes after the share so the most relevant
 * number leads.
 */
const VotingChip = ({ pattern }: { pattern: VotingPattern }) => {
  const leadingShare = pattern.rPct >= pattern.dPct ? pattern.rPct : pattern.dPct;
  const leadingParty = pattern.rPct >= pattern.dPct ? 'R' : 'D';
  const tone =
    pattern.bucket === 'strongly_r' || pattern.bucket === 'lean_r'
      ? 'bg-red-50 border-red-200 text-red-800'
      : pattern.bucket === 'strongly_d' || pattern.bucket === 'lean_d'
        ? 'bg-blue-50 border-blue-200 text-blue-800'
        : 'bg-gray-100 border-gray-200 text-gray-700';
  const label =
    pattern.bucket === 'balanced'
      ? `Balanced ${pattern.year}`
      : `${leadingShare.toFixed(0)}% ${leadingParty} (${pattern.year})`;
  const title =
    `Last presidential vote: D ${pattern.dPct.toFixed(1)}% · ` +
    `R ${pattern.rPct.toFixed(1)}% · margin ${pattern.marginPp.toFixed(1)}pp`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={title}
    >
      🗳 {label}
    </span>
  );
};

interface MarketContextProps {
  property: Property;
}

/**
 * "Property as a stock" — small market-context panel rendered on
 * PropertyDetail. Computes county + state percentile and a list of
 * the 5 most-similar listings entirely from the corpus already
 * loaded by `useProperties`. No new fetches.
 *
 * Only renders if there's enough comp depth to be useful (≥3 county
 * rows OR ≥10 state rows). Rendering nothing on a thin sample is
 * better than misleading numbers off a 1-row "median".
 */
export const MarketContext = ({ property }: MarketContextProps) => {
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  const stats = useMemo(
    () => computeMarketStats(property, allProperties),
    [property, allProperties],
  );

  // Bail if we don't have enough comparison material to be meaningful.
  if (stats.countyComps < 3 && stats.stateComps < 10) {
    return null;
  }

  const countyName = property.location?.county;
  const stateName = property.location?.state;
  const subjPpa = property.pricePerAcre;

  const renderRow = (
    scope: string,
    median: number | null,
    percentile: number | null,
    comps: number,
  ) => {
    if (median === null) return null;
    const delta = median > 0 ? Math.round(((subjPpa - median) / median) * 100) : 0;
    const deltaLabel = delta === 0 ? 'at median' : delta < 0 ? `${Math.abs(delta)}% below` : `${delta}% above`;
    const deltaColor = delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-orange-700' : 'text-gray-600';
    return (
      <div className="flex items-center justify-between text-sm py-1">
        <div className="text-gray-700">
          <span className="font-medium">{scope}</span>
          <span className="text-xs text-gray-400 ml-1.5">
            ({comps} comp{comps === 1 ? '' : 's'})
          </span>
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className="text-gray-500">
            median {formatPricePerAcre(median)}
          </span>
          <span className={`font-semibold ${deltaColor}`}>{deltaLabel}</span>
          {percentile !== null && (
            <span className="text-xs text-gray-400">p{percentile}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <header className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-gray-900 text-sm">Market context</h3>
        <span className="text-xs text-gray-400">
          this listing: {formatPricePerAcre(subjPpa)}
        </span>
      </header>

      {property.votingPattern && (
        <div className="mb-2">
          <VotingChip pattern={property.votingPattern} />
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {renderRow(
          countyName ?? 'County',
          stats.countyMedianPricePerAcre,
          stats.countyPercentile,
          stats.countyComps,
        )}
        {renderRow(
          stateName ?? 'State',
          stats.stateMedianPricePerAcre,
          stats.statePercentile,
          stats.stateComps,
        )}
      </div>

      {stats.similarListings.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            Similar listings in {countyName ?? 'the same county'}
          </p>
          <ul className="space-y-1">
            {stats.similarListings.map((p) => {
              const delta = subjPpa > 0
                ? Math.round(((p.pricePerAcre - subjPpa) / subjPpa) * 100)
                : 0;
              return (
                <li key={p.id} className="flex items-center justify-between text-xs">
                  <Link
                    to={`/p/${encodeURIComponent(p.id)}`}
                    className="truncate text-gray-700 hover:text-green-700 hover:underline flex-1 min-w-0 mr-2"
                  >
                    {p.title}
                  </Link>
                  <span className="text-gray-500 flex-shrink-0">
                    {formatPricePerAcre(p.pricePerAcre)}
                    {subjPpa > 0 && (
                      <span
                        className={`ml-1.5 ${
                          delta < 0
                            ? 'text-emerald-600'
                            : delta > 0
                              ? 'text-orange-600'
                              : 'text-gray-400'
                        }`}
                      >
                        ({delta >= 0 ? '+' : ''}
                        {delta}%)
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-400 leading-snug">
        County / state medians use current inventory only (sold and pending
        rows excluded). p-rank shows where this listing sits in the
        cheapest-to-most-expensive distribution — p20 means cheaper than 80%
        of comps.
      </p>
    </section>
  );
};
