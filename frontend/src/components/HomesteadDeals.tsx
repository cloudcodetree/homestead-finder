import { CuratedPick, HomesteadDealsResult, Property } from '../types/property';
import {
  formatAcreage,
  formatPrice,
  formatPricePerAcre,
  formatSourceName,
} from '../utils/formatters';
import { getDealScoreColor } from '../utils/scoring';

interface HomesteadDealsProps {
  deals: HomesteadDealsResult;
  properties: Property[];
  onSelectProperty: (id: string) => void;
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const FunnelBadge = ({ deals }: { deals: HomesteadDealsResult }) => (
  <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
    <span className="font-semibold">Funnel:</span>{' '}
    {deals.totalListings.toLocaleString()} listings →{' '}
    <span className="font-medium">{deals.passedFiltersCount}</span> passed
    homestead filters →{' '}
    <span className="font-medium">{deals.candidateCount}</span> candidates ranked →{' '}
    <span className="font-bold">{deals.pickCount}</span> picks
  </div>
);

const DealCard = ({
  pick,
  property,
  onClick,
}: {
  pick: CuratedPick;
  property: Property | undefined;
  onClick: () => void;
}) => {
  const stale = !property;
  return (
    <article
      onClick={property ? onClick : undefined}
      className={`group relative bg-white rounded-lg border p-4 sm:p-5 flex gap-4 transition-all ${
        stale
          ? 'border-gray-200 opacity-60'
          : 'border-emerald-200 cursor-pointer hover:border-emerald-400 hover:shadow-md'
      }`}
    >
      <div className="flex-shrink-0">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-emerald-600 to-emerald-800 text-white font-bold text-lg sm:text-xl flex items-center justify-center shadow-sm">
          {pick.rank}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
          <h3 className="font-semibold text-gray-900 text-base leading-snug">
            {pick.headline}
          </h3>
          {property && (
            <div
              className={`rounded-full px-2 py-0.5 text-xs font-bold flex-shrink-0 ${getDealScoreColor(
                property.dealScore
              )}`}
              title={`Deal Score: ${property.dealScore}`}
            >
              {property.dealScore}
            </div>
          )}
        </div>

        {property ? (
          <p className="text-xs text-gray-500 mb-2">
            {property.location.county} County, {property.location.state} ·{' '}
            {formatSourceName(property.source)}
          </p>
        ) : (
          <p className="text-xs text-gray-400 italic mb-2">
            (Listing {pick.id} not currently loaded — may have been removed since
            curation.)
          </p>
        )}

        <p className="text-sm text-gray-700 leading-relaxed mb-3">{pick.reason}</p>

        {property && (
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-gray-900 font-semibold">
              {formatPrice(property.price)}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-700">
              {formatAcreage(property.acreage)}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600 text-xs">
              {formatPricePerAcre(property.pricePerAcre)}
            </span>
            {property.homesteadFitScore !== undefined && (
              <span className="ml-auto text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 font-medium">
                Fit {property.homesteadFitScore}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

export const HomesteadDeals = ({
  deals,
  properties,
  onSelectProperty,
}: HomesteadDealsProps) => {
  const byId = new Map(properties.map((p) => [p.id, p]));

  if (!deals.picks || deals.picks.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-4xl mb-3">🌾</p>
        <p className="text-gray-600 font-medium">No homestead deals yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Run{' '}
          <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
            python -m scraper.deals
          </code>{' '}
          locally to generate the curated list.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
              Homestead Deals
            </h2>
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium tracking-wide uppercase">
              AI curated
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Genuinely-buildable, reasonably-priced land for self-sufficient
            living. Claude {deals.model} · {formatDate(deals.generatedAt)}
          </p>
        </div>

        {/* Funnel + filter summary */}
        <div className="mb-5 space-y-2">
          <FunnelBadge deals={deals} />
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer hover:text-gray-900 font-medium">
              What "passed homestead filters" means
            </summary>
            <ul className="mt-2 pl-4 list-disc space-y-0.5 text-gray-600">
              <li>
                Price ≤ {formatPrice(deals.filterSummary.maxPriceUsd)}, acreage ≥{' '}
                {deals.filterSummary.minAcres}
              </li>
              <li>
                Not inside a FEMA floodplain (
                {deals.filterSummary.sfhaZonesExcluded.join(', ')})
              </li>
              <li>
                Soil capability class ≤{' '}
                {deals.filterSummary.maxSoilCapabilityClass}/8 (actually
                buildable / arable)
              </li>
              <li>
                No critical red flags ({' '}
                {deals.filterSummary.criticalRedFlagsExcluded
                  .map((f) => f.replace(/_/g, ' '))
                  .join(' · ')}
                )
              </li>
              <li>Tax-sale rows excluded (different diligence pipeline)</li>
            </ul>
          </details>
        </div>

        {/* Picks */}
        <div className="space-y-3">
          {deals.picks.map((pick) => {
            const p = byId.get(pick.id);
            return (
              <DealCard
                key={pick.id}
                pick={pick}
                property={p}
                onClick={() => p && onSelectProperty(pick.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
