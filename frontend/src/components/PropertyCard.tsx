import { Property, FEATURE_LABELS } from '../types/property';
import { formatPrice, formatAcreage, formatPricePerAcre, formatDaysAgo, formatSourceName } from '../utils/formatters';
import { getDealScoreColor, getDealScoreLabel, getDealScoreBorderColor } from '../utils/scoring';

interface PropertyCardProps {
  property: Property;
  onClick: (id: string) => void;
  isSelected?: boolean;
}

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
        <div className={`flex-shrink-0 rounded-full px-2 py-1 text-xs font-bold ${scoreColor}`}>
          {property.dealScore}
        </div>
      </div>

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
