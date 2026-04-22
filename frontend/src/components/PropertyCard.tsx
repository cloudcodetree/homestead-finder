import { Property, FEATURE_LABELS } from '../types/property';
import { PropertyThumbnail } from './PropertyThumbnail';
import {
  formatAcreage,
  formatCountyState,
  formatDaysAgo,
  formatPrice,
  formatPricePerAcre,
  formatSourceName,
} from '../utils/formatters';
import { getListingTypeStyle } from '../utils/listingType';
import { getDealScoreColor, getDealScoreLabel, getDealScoreBorderColor } from '../utils/scoring';

interface PropertyCardProps {
  property: Property;
  onClick: (id: string) => void;
  isSelected?: boolean;
}

const ValidationBadge = ({ status }: { status?: Property['status'] }) => {
  const s = status ?? 'unverified';
  if (s === 'tax_sale') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-50 border border-orange-300 px-1.5 py-0.5 text-xs font-bold text-orange-700">
        ⚖ Tax Sale
      </span>
    );
  }
  if (s === 'active') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-xs font-medium text-green-700">
        ✓ Verified
      </span>
    );
  }
  if (s === 'expired') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-xs font-medium text-red-600">
        ✗ Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 text-xs font-medium text-yellow-700">
      ⚠ Unverified
    </span>
  );
};

export const PropertyCard = ({ property, onClick, isSelected = false }: PropertyCardProps) => {
  const scoreColor = getDealScoreColor(property.dealScore);
  const scoreBorder = getDealScoreBorderColor(property.dealScore);
  const typeStyle = getListingTypeStyle(property);

  return (
    <div
      className={`rounded-lg border-2 bg-white cursor-pointer transition-all hover:shadow-md overflow-hidden ${
        isSelected ? `${scoreBorder} shadow-md` : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={() => onClick(property.id)}
    >
      {/* Listing-type accent stripe — colored bar above the thumbnail
          signals tax sale vs owner-finance vs standard for-sale at a
          glance. Full-width, 4px tall. */}
      <div className={`h-1 ${typeStyle.accentBar}`} aria-hidden="true" />
      <PropertyThumbnail property={property} width={400} className="w-full h-32" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
              {property.title}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="truncate">
                {formatCountyState(property.location.county, property.location.state)} &middot;{' '}
                {formatSourceName(property.source)}
              </span>
              <span
                title={typeStyle.description}
                className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-medium whitespace-nowrap ${typeStyle.badgePill}`}
              >
                {typeStyle.label}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              {property.homesteadFitScore !== undefined ? (
                <div
                  className="rounded-full px-2 py-1 text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200"
                  title={`AI Homestead Fit: ${property.homesteadFitScore}/100${property.aiSummary ? ` — ${property.aiSummary}` : ''}`}
                >
                  ◆ {property.homesteadFitScore}
                </div>
              ) : (
                <div
                  className="rounded-full px-1.5 py-1 text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200"
                  title="Not yet AI-analyzed — run ./scripts/refresh_ai.sh locally to enrich"
                >
                  ◇
                </div>
              )}
              <div
                className={`rounded-full px-2 py-1 text-xs font-bold ${scoreColor}`}
                title={`Deal Score: ${property.dealScore}`}
              >
                {property.dealScore}
              </div>
            </div>
            <ValidationBadge status={property.status} />
          </div>
        </div>

        {(property.redFlags?.length ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            <span>⚠</span>
            <span className="font-medium">
              {property.redFlags!.length} red flag{property.redFlags!.length === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-4">
          {property.status === 'tax_sale' && property.taxSale ? (
            // Tax-sale rows don't have a listing price — they have an amount
            // owed (the minimum bid for the lien/deed). Surface that plus the
            // investment analytics (multiple for deed states, return % for
            // lien states) so the card answers "is this a good buy" at a glance.
            <>
              <div>
                <p className="text-lg font-bold text-orange-700">
                  {formatPrice(property.taxSale.amountOwedUsd)}
                </p>
                <p className="text-xs text-gray-500">owed (min bid)</p>
              </div>
              <div className="text-gray-300">|</div>
              {property.taxSale.investmentMultiple !== null &&
              property.taxSale.investmentMultiple !== undefined ? (
                <div>
                  <p
                    className={`text-lg font-bold ${
                      property.taxSale.investmentMultiple >= 3
                        ? 'text-green-700'
                        : property.taxSale.investmentMultiple >= 1
                          ? 'text-amber-700'
                          : 'text-red-700'
                    }`}
                    title={(property.taxSale.analyticsNotes ?? []).join(' • ')}
                  >
                    {property.taxSale.investmentMultiple.toFixed(1)}×
                  </p>
                  <p className="text-xs text-gray-500">deed-sale upside</p>
                </div>
              ) : property.taxSale.expectedReturnPct !== null &&
                property.taxSale.expectedReturnPct !== undefined ? (
                <div>
                  <p
                    className={`text-lg font-bold ${
                      property.taxSale.expectedReturnPct >= 15
                        ? 'text-green-700'
                        : property.taxSale.expectedReturnPct >= 10
                          ? 'text-amber-700'
                          : 'text-gray-600'
                    }`}
                    title={(property.taxSale.analyticsNotes ?? []).join(' • ')}
                  >
                    {property.taxSale.expectedReturnPct.toFixed(0)}%/yr
                  </p>
                  <p className="text-xs text-gray-500">lien return</p>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="text-sm font-mono font-medium text-gray-700 truncate">
                    {property.taxSale.parcelId}
                  </p>
                  <p className="text-xs text-gray-500">
                    {property.taxSale.parcelType === 'town_lot'
                      ? 'town lot — no est.'
                      : 'unsized parcel'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-lg font-bold text-gray-900">{formatPrice(property.price)}</p>
                <p className="text-xs text-gray-500">{formatPricePerAcre(property.pricePerAcre)}</p>
              </div>
              <div className="text-gray-300">|</div>
              <div>
                <p className="text-base font-semibold text-gray-700">
                  {formatAcreage(property.acreage)}
                </p>
                <p className="text-xs text-gray-500">{getDealScoreLabel(property.dealScore)}</p>
              </div>
            </>
          )}
        </div>

        {property.features.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {property.features.slice(0, 4).map((feature) => (
              <span
                key={feature}
                className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700 border border-green-200"
              >
                {FEATURE_LABELS[feature]}
              </span>
            ))}
            {property.features.length > 4 && (
              <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                +{property.features.length - 4}
              </span>
            )}
          </div>
        )}

        <p className="mt-2 text-xs text-gray-400">{formatDaysAgo(property.dateFound)}</p>
      </div>
    </div>
  );
};
