import { Property, FEATURE_LABELS } from '../types/property';
import {
  formatPrice,
  formatAcreage,
  formatPricePerAcre,
  formatDate,
  formatSourceName,
} from '../utils/formatters';
import { getDealScoreColor, getDealScoreLabel } from '../utils/scoring';

interface PropertyDetailProps {
  property: Property;
  onClose: () => void;
}

export const PropertyDetail = ({ property, onClose }: PropertyDetailProps) => {
  const scoreColor = getDealScoreColor(property.dealScore);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-base leading-tight">{property.title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {property.location.county} County, {property.location.state}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className={`rounded-full px-3 py-1 text-sm font-bold ${scoreColor}`}>
              {property.dealScore} — {getDealScoreLabel(property.dealScore)}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Key Stats */}
          <div className={`grid gap-3 ${property.acreage > 0 ? 'grid-cols-3' : 'grid-cols-1'}`}>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{formatPrice(property.price)}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {property.acreage > 0 ? 'Asking Price' : 'Face Value'}
              </p>
            </div>
            {property.acreage > 0 && (
              <>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {formatAcreage(property.acreage)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Total Acreage</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {formatPricePerAcre(property.pricePerAcre)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Price / Acre</p>
                </div>
              </>
            )}
          </div>

          {/* Description */}
          {property.description && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1.5">Description</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{property.description}</p>
            </div>
          )}

          {/* Features */}
          {property.features.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Features</h3>
              <div className="flex flex-wrap gap-2">
                {property.features.map((feature) => (
                  <span
                    key={feature}
                    className="rounded-full bg-green-50 border border-green-200 px-3 py-1 text-sm text-green-700 font-medium"
                  >
                    {FEATURE_LABELS[feature]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Source</p>
              <p className="text-gray-800 font-medium">{formatSourceName(property.source)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Found</p>
              <p className="text-gray-800 font-medium">{formatDate(property.dateFound)}</p>
            </div>
            {property.daysOnMarket !== undefined && (
              <div>
                <p className="text-gray-500 text-xs">Days on Market</p>
                <p className="text-gray-800 font-medium">{property.daysOnMarket} days</p>
              </div>
            )}
            {(property.location.lat !== 0 || property.location.lng !== 0) && (
              <div>
                <p className="text-gray-500 text-xs">Location</p>
                <p className="text-gray-800 font-medium">
                  {property.location.lat.toFixed(4)}, {property.location.lng.toFixed(4)}
                </p>
              </div>
            )}
          </div>

          {/* CTA */}
          <a
            href={property.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            View Full Listing →
          </a>
        </div>
      </div>
    </div>
  );
};
