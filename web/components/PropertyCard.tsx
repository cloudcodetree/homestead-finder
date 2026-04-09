import Link from 'next/link';
import type { Property } from '@/types/property';
import { FEATURE_LABELS } from '@/types/property';
import {
  formatPrice,
  formatAcreage,
  formatPricePerAcre,
  formatDaysAgo,
  formatSourceName,
} from '@/lib/formatters';
import {
  getDealScoreColor,
  getDealScoreLabel,
  getDealScoreBorderColor,
} from '@/lib/scoring';
import { ValidationBadge } from './ValidationBadge';

interface PropertyCardProps {
  property: Property;
}

const extractFromDescription = (description: string, field: string): string => {
  const match = description.match(new RegExp(`${field}:\\s*([^.]+)`));
  return match ? match[1].trim() : '';
};

const getSaleTypeBadge = (
  description: string,
): { label: string; className: string } | null => {
  const type = extractFromDescription(description, 'Type');
  if (!type) return null;
  if (type.toLowerCase().includes('lien'))
    return {
      label: 'Tax Lien',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    };
  if (type.toLowerCase().includes('deed'))
    return {
      label: 'Tax Deed',
      className: 'bg-purple-50 text-purple-700 border-purple-200',
    };
  if (type.toLowerCase().includes('foreclosure'))
    return {
      label: 'Foreclosure',
      className: 'bg-red-50 text-red-700 border-red-200',
    };
  return {
    label: type,
    className: 'bg-gray-50 text-gray-700 border-gray-200',
  };
};

export const PropertyCard = ({ property }: PropertyCardProps) => {
  const scoreColor = getDealScoreColor(property.dealScore);
  const scoreBorder = getDealScoreBorderColor(property.dealScore);
  const parcel = extractFromDescription(property.description ?? '', 'Parcel');
  const saleType = getSaleTypeBadge(property.description ?? '');

  return (
    <Link
      href={`/deals/${encodeURIComponent(property.id)}`}
      className={`block rounded-lg border-2 bg-white p-4 transition-all hover:shadow-md border-gray-200 hover:${scoreBorder}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {property.title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {property.location.county} County, {property.location.state} &middot;{' '}
            {formatSourceName(property.source)}
          </p>
          {parcel && (
            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
              Parcel: {parcel}
            </p>
          )}
        </div>
        {/* Score + ValidationBadge stacked (matches current frontend layout) */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div
            className={`rounded-full px-2 py-1 text-xs font-bold ${scoreColor}`}
          >
            {property.dealScore}
          </div>
          <ValidationBadge status={property.status} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div>
          <p className="text-lg font-bold text-gray-900">
            {formatPrice(property.price)}
          </p>
          <p className="text-xs text-gray-500">
            {formatPricePerAcre(property.pricePerAcre) || 'Face value'}
          </p>
        </div>
        {property.acreage > 0 && (
          <>
            <div className="text-gray-300">|</div>
            <div>
              <p className="text-base font-semibold text-gray-700">
                {formatAcreage(property.acreage)}
              </p>
            </div>
          </>
        )}
        <div className="ml-auto">
          <p className="text-xs text-gray-500">
            {getDealScoreLabel(property.dealScore)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {saleType && (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-xs border font-medium ${saleType.className}`}
          >
            {saleType.label}
          </span>
        )}
        {property.features.slice(0, 3).map((feature) => (
          <span
            key={feature}
            className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700 border border-green-200"
          >
            {FEATURE_LABELS[feature]}
          </span>
        ))}
        {property.features.length > 3 && (
          <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            +{property.features.length - 3}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        {formatDaysAgo(property.dateFound)}
      </p>
    </Link>
  );
};
