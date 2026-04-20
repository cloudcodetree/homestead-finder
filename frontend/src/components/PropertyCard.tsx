import { Property, FEATURE_LABELS } from '../types/property';
import { formatPrice, formatAcreage, formatPricePerAcre, formatDaysAgo, formatSourceName } from '../utils/formatters';
import { getDealScoreColor, getDealScoreLabel, getDealScoreBorderColor } from '../utils/scoring';

interface PropertyCardProps {
  property: Property;
  onClick: (id: string) => void;
  isSelected?: boolean;
}

const ValidationBadge = ({ status }: { status?: Property['status'] }) => {
  const s = status ?? 'unverified';
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

  return (
    <div
      className={`rounded-lg border-2 bg-white p-4 cursor-pointer transition-all hover:shadow-md ${
        isSelected ? `${scoreBorder} shadow-md` : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={() => onClick(property.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {property.title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {property.location.county} County, {property.location.state} &middot; {formatSourceName(property.source)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-1">
            {property.homesteadFitScore !== undefined && (
              <div
                className="rounded-full px-2 py-1 text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200"
                title={`AI Homestead Fit Score: ${property.homesteadFitScore}`}
              >
                ◆ {property.homesteadFitScore}
              </div>
            )}
            <div className={`rounded-full px-2 py-1 text-xs font-bold ${scoreColor}`} title={`Deal Score: ${property.dealScore}`}>
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
        <div>
          <p className="text-lg font-bold text-gray-900">{formatPrice(property.price)}</p>
          <p className="text-xs text-gray-500">{formatPricePerAcre(property.pricePerAcre)}</p>
        </div>
        <div className="text-gray-300">|</div>
        <div>
          <p className="text-base font-semibold text-gray-700">{formatAcreage(property.acreage)}</p>
          <p className="text-xs text-gray-500">{getDealScoreLabel(property.dealScore)}</p>
        </div>
      </div>

      {property.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {property.features.slice(0, 4).map(feature => (
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
  );
};
