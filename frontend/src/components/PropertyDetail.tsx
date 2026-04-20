import { useState } from 'react';
import { Property, FEATURE_LABELS, AI_TAG_LABELS, RED_FLAG_LABELS } from '../types/property';
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

const ValidationBadge = ({ status }: { status?: Property['status'] }) => {
  const s = status ?? 'unverified';
  if (s === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700">
        ✓ Verified
      </span>
    );
  }
  if (s === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-medium text-red-600">
        ✗ Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-700">
      ⚠ Unverified
    </span>
  );
};

export const PropertyDetail = ({ property, onClose }: PropertyDetailProps) => {
  const scoreColor = getDealScoreColor(property.dealScore);
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(property.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
            <ValidationBadge status={property.status} />
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

          {/* AI Analysis */}
          {property.enrichedAt && (
            <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-purple-900">AI Analysis</h3>
                {property.homesteadFitScore !== undefined && (
                  <span className="text-xs font-bold text-purple-700 bg-white border border-purple-200 rounded-full px-2 py-0.5">
                    Fit {property.homesteadFitScore}/100
                  </span>
                )}
                <span className="ml-auto text-[10px] text-purple-500 tracking-wide uppercase font-medium">
                  Beta
                </span>
              </div>
              {property.aiSummary && (
                <p className="text-sm text-gray-700 leading-relaxed mb-3">
                  {property.aiSummary}
                </p>
              )}
              {(property.redFlags?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1.5">⚠ Red Flags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {property.redFlags!.map((flag) => (
                      <span
                        key={flag}
                        className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700 font-medium"
                      >
                        {RED_FLAG_LABELS[flag]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(property.aiTags?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-purple-800 mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {property.aiTags!.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white border border-purple-200 px-2 py-0.5 text-xs text-purple-700 font-medium"
                      >
                        {AI_TAG_LABELS[tag]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* Listing URL */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-gray-500 text-xs mb-1">Listing URL</p>
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={property.url}
                target="_blank"
                rel="noopener noreferrer"
                title={property.url}
                className="text-blue-600 hover:underline text-sm truncate min-w-0 flex-1"
              >
                {property.url}
              </a>
              <button
                onClick={copyUrl}
                title="Copy URL"
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {copied ? (
                  <span className="text-xs text-green-600 font-medium whitespace-nowrap">Copied!</span>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* CTA */}
          <div>
            {property.status === 'unverified' && (
              <p className="text-xs text-yellow-700 text-center mb-2">
                ⚠ Sample listing — link may not work
              </p>
            )}
            {property.status === 'expired' && (
              <p className="text-xs text-red-600 text-center mb-2">
                ✗ This listing has expired or is no longer available
              </p>
            )}
            <a
              href={property.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block w-full text-center font-semibold py-3 rounded-lg transition-colors ${
                property.status === 'expired'
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              View Full Listing →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
