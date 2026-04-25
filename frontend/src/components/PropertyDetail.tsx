import { useState } from 'react';
import {
  Property,
  FEATURE_LABELS,
  AI_TAG_LABELS,
  AI_TAG_DESCRIPTIONS,
  RED_FLAG_LABELS,
  RED_FLAG_DESCRIPTIONS,
  RED_FLAG_SEVERITY,
} from '../types/property';
import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useSavedListings } from '../hooks/useSavedListings';
import { AddToProjectButton } from './AddToProjectButton';
import { PrivateNote } from './PrivateNote';
import { PropertyThumbnail } from './PropertyThumbnail';
import { RatingBar } from './RatingBar';
import { ResearchPanel } from './ResearchPanel';
import {
  formatAcreage,
  formatCountyState,
  formatDate,
  formatPrice,
  formatPricePerAcre,
  formatSourceName,
} from '../utils/formatters';
import { safeUrl } from '../utils/safeUrl';
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
        ✗ Sold
      </span>
    );
  }
  if (s === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
        ⟳ Pending / Under Contract
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
  const { user, loginWithGoogle } = useAuth();
  const { isSaved, toggle: toggleSaved } = useSavedListings();
  const { isHidden, toggle: toggleHidden } = useHiddenListings();
  const saved = isSaved(property.id);
  const hidden = isHidden(property.id);

  const copyUrl = () => {
    navigator.clipboard.writeText(property.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    // `z-[9999]` beats Leaflet's internal pane z-indexes (up to 700)
    // so the detail modal always stacks above an active Map view.
    // Tailwind's `z-50` (= 50) wasn't enough — markers were painting
    // through the overlay when a listing was opened from the map.
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50">
      <div className="relative bg-white w-full sm:max-w-2xl sm:rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Sticky close-button anchor — a zero-height sticky container
            keeps the absolutely-positioned button pinned to the top of
            the modal's viewport as the user scrolls. Previously the
            button was absolute-positioned over the hero image and
            scrolled away with content; users had to scroll back up to
            dismiss the modal. Now it floats at top-right regardless of
            scroll position. Dark-glass backdrop keeps it legible over
            the hero image at the top AND the white content below. */}
        <div className="sticky top-0 z-20 h-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white text-lg leading-none flex items-center justify-center transition-colors shadow-lg"
          >
            ✕
          </button>
        </div>
        {/* Hero image — full-bleed banner above the sticky header.
            Phase 1 shows the primary image only; Phase 2 will replace
            this with a swipeable carousel when the scraper captures
            galleries during detail-page fetch. */}
        <PropertyThumbnail property={property} width={768} className="w-full h-48 sm:h-56" />
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-base leading-tight">{property.title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatCountyState(property.location.county, property.location.state)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ValidationBadge status={property.status} />
            <div className={`rounded-full px-3 py-1 text-sm font-bold ${scoreColor}`}>
              {property.dealScore} — {getDealScoreLabel(property.dealScore)}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Tax-sale banner (shown first when this is a delinquent-tax listing) */}
          {property.status === 'tax_sale' && property.taxSale && (
            <div className="rounded-lg border-2 border-orange-300 bg-orange-50/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">⚖</span>
                <h3 className="font-bold text-orange-900">Delinquent County Tax Sale</h3>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-orange-200 text-orange-800 rounded font-medium uppercase tracking-wide">
                  {property.taxSale.stateType === 'deed' ? 'Deed' : 'Lien'} State
                </span>
              </div>
              <p className="text-sm text-gray-700 mb-3">
                This is a <strong>tax-sale listing</strong>, not a traditional for-sale property.{' '}
                {property.taxSale.stateType === 'deed'
                  ? 'Winning bidder gets the deed outright.'
                  : 'Winning bidder gets a lien certificate; deed may be obtainable after the redemption period.'}{' '}
                Do full title/quiet-title diligence before paying.
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-gray-500">Minimum bid (owed)</dt>
                  <dd className="text-lg font-bold text-orange-700">
                    {formatPrice(property.taxSale.amountOwedUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Tax year</dt>
                  <dd className="font-semibold text-gray-800">{property.taxSale.taxYear ?? '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-gray-500">Parcel ID</dt>
                  <dd className="font-mono text-gray-800">{property.taxSale.parcelId}</dd>
                </div>
                {property.taxSale.owner && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Owner of record</dt>
                    <dd className="text-gray-800">{property.taxSale.owner}</dd>
                  </div>
                )}
                {property.taxSale.legalDescription && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Legal description</dt>
                    <dd className="text-gray-800 italic text-[11px]">
                      {property.taxSale.legalDescription}
                    </dd>
                  </div>
                )}
                {(property.taxSale.houseNumber || property.taxSale.street) && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Situs address</dt>
                    <dd className="text-gray-800">
                      {[property.taxSale.houseNumber, property.taxSale.street]
                        .filter(Boolean)
                        .join(' ')}
                    </dd>
                  </div>
                )}
                {property.taxSale.saleMonth && (
                  <div>
                    <dt className="text-gray-500">Typical sale month</dt>
                    <dd className="text-gray-800">
                      {new Date(2000, property.taxSale.saleMonth - 1).toLocaleString(undefined, {
                        month: 'long',
                      })}
                    </dd>
                  </div>
                )}
                {property.taxSale.listUrl && (
                  <div className="col-span-2">
                    <a
                      href={safeUrl(property.taxSale.listUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-700 hover:text-orange-900 font-medium text-xs"
                    >
                      Open original county tax-sale list (PDF) →
                    </a>
                  </div>
                )}
              </dl>

              {/* Investment analysis (from scraper/sources/tax_sale_analytics.py) */}
              {(property.taxSale.investmentMultiple != null ||
                property.taxSale.expectedReturnPct != null ||
                (property.taxSale.analyticsNotes ?? []).length > 0) && (
                <div className="mt-4 pt-4 border-t border-orange-200">
                  <h4 className="text-xs font-bold text-orange-900 uppercase tracking-wide mb-2">
                    Investment analysis
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    {property.taxSale.parcelType && (
                      <div>
                        <dt className="text-gray-500">Parcel type</dt>
                        <dd className="font-semibold text-gray-800 capitalize">
                          {property.taxSale.parcelType.replace('_', ' ')}
                        </dd>
                      </div>
                    )}
                    {property.taxSale.estimatedAcres != null && (
                      <div>
                        <dt className="text-gray-500">Estimated acres</dt>
                        <dd className="font-semibold text-gray-800">
                          {property.taxSale.estimatedAcres.toFixed(2)}
                        </dd>
                      </div>
                    )}
                    {property.taxSale.estimatedValueUsd != null && (
                      <div>
                        <dt className="text-gray-500">Est. market value</dt>
                        <dd className="font-semibold text-gray-800">
                          {formatPrice(property.taxSale.estimatedValueUsd)}
                        </dd>
                      </div>
                    )}
                    {property.taxSale.investmentMultiple != null && (
                      <div>
                        <dt className="text-gray-500">Upside multiple</dt>
                        <dd
                          className={`font-bold ${
                            property.taxSale.investmentMultiple >= 3
                              ? 'text-green-700'
                              : property.taxSale.investmentMultiple >= 1
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {property.taxSale.investmentMultiple.toFixed(1)}× min bid
                        </dd>
                      </div>
                    )}
                    {property.taxSale.expectedReturnPct != null && (
                      <div>
                        <dt className="text-gray-500">Expected annual return</dt>
                        <dd
                          className={`font-bold ${
                            property.taxSale.expectedReturnPct >= 15
                              ? 'text-green-700'
                              : property.taxSale.expectedReturnPct >= 10
                                ? 'text-amber-700'
                                : 'text-gray-700'
                          }`}
                        >
                          {property.taxSale.expectedReturnPct.toFixed(1)}% /yr
                        </dd>
                      </div>
                    )}
                  </div>
                  {(property.taxSale.analyticsNotes ?? []).length > 0 && (
                    <ul className="mt-3 list-disc pl-4 text-[11px] text-gray-700 space-y-0.5">
                      {property.taxSale.analyticsNotes!.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-[10px] text-gray-500 italic">
                    Estimates use county median $/acre from LandWatch comps minus a ~$5,000 pad for
                    title/legal/quiet-title costs. Lien returns weight a {85}% redemption
                    probability at the state statutory interest rate. Do your own diligence — these
                    are rough triage numbers, not investment advice.
                  </p>
                </div>
              )}
            </div>
          )}

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
                  <p className="text-xs text-gray-500 mt-0.5">
                    Price / Acre
                    {property.residualPricePerAcre &&
                    property.estimatedStructureValueUsd &&
                    property.estimatedStructureValueUsd > 0 ? (
                      <span
                        className="ml-1 text-[10px] text-gray-400"
                        title={`Land-only $/ac after subtracting ~${formatPrice(property.estimatedStructureValueUsd)} estimated structure value`}
                      >
                        &nbsp;({formatPricePerAcre(property.residualPricePerAcre)} land)
                      </span>
                    ) : null}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Total-cost-to-homestead — the decision-driver view.
              Sums the asking price + estimated build-out to reach move-
              in-ready. For already-ready listings, buildout=0 and this
              just echoes the asking price. Honest: we can't know a
              buyer's finishing standards, so the number is a floor. */}
          {property.acreage > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="text-sm font-semibold text-emerald-900">
                  Total cost to live here
                </h3>
                {property.moveInReady && (
                  <span className="text-xs font-bold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
                    🏠 Move-in ready
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Asking</p>
                  <p className="font-semibold text-gray-800">{formatPrice(property.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">
                    {property.moveInReady ? 'Build-out needed' : 'Est. build-out to ready'}
                  </p>
                  <p
                    className={`font-semibold ${
                      (property.estimatedBuildoutUsd ?? 0) === 0
                        ? 'text-emerald-700'
                        : 'text-gray-800'
                    }`}
                  >
                    {formatPrice(property.estimatedBuildoutUsd ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total to homestead</p>
                  <p className="text-xl font-bold text-emerald-800">
                    {formatPrice(property.price + (property.estimatedBuildoutUsd ?? 0))}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-3">
                Estimate assumes a modest cabin/modular build if no dwelling,
                basic well + septic, off-grid solar if no utility service.
                Add your own finishes / acreage improvements on top.
                {property.estimatedStructureValueUsd &&
                property.estimatedStructureValueUsd > 0 ? (
                  <>
                    {' '}
                    Detected structures: ~{formatPrice(property.estimatedStructureValueUsd)}{' '}
                    already in place.
                  </>
                ) : null}
              </p>
            </div>
          )}

          {/* Nearest-town proximity — surfaces geoEnrichment.proximity
              with context that helps a buyer underwrite access costs
              (hospital, internet, grocery). */}
          {property.geoEnrichment?.proximity?.nearestTownName && (
            <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-3">
              <div className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">📍</span>
                <div className="flex-1 text-sm">
                  <p className="font-medium text-sky-900">
                    {property.geoEnrichment.proximity.nearestTownDistanceMiles?.toFixed(1)} mi to{' '}
                    {property.geoEnrichment.proximity.nearestTownName}
                    {property.geoEnrichment.proximity.nearestTownPopulation &&
                      ` (pop ${property.geoEnrichment.proximity.nearestTownPopulation.toLocaleString()})`}
                  </p>
                  <p className="text-xs text-sky-700/80 mt-0.5">
                    Nearest named town ≥5k. Drive time is roughly 1.5×
                    linear miles on Ozark back roads.
                    {(property.geoEnrichment.proximity.namedWaterFeatures ?? []).length > 0 && (
                      <>
                        {' '}
                        Nearby water: {property.geoEnrichment.proximity.namedWaterFeatures!.slice(0, 2).join(', ')}.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {property.enrichedAt ? (
            <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h3 className="text-sm font-semibold text-purple-900">AI Analysis</h3>
                {property.homesteadFitScore !== undefined && (
                  <span className="text-xs font-bold text-purple-700 bg-white border border-purple-200 rounded-full px-2 py-0.5">
                    Fit {property.homesteadFitScore}/100
                  </span>
                )}
                <span
                  className="text-[11px] text-purple-600/80"
                  title={`Full timestamp: ${property.enrichedAt}`}
                >
                  analyzed {formatDate(property.enrichedAt)}
                </span>
                <span className="ml-auto text-[10px] text-purple-500 tracking-wide uppercase font-medium">
                  Beta
                </span>
              </div>
              {property.aiSummary ? (
                <div className="mb-3">
                  <p className="text-[11px] font-semibold text-purple-800 mb-1 uppercase tracking-wide">
                    Why it scored this way
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed italic">
                    &ldquo;{property.aiSummary}&rdquo;
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mb-3">
                  (No written summary available for this listing.)
                </p>
              )}
              {(property.redFlags?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1.5">
                    ⚠ Red Flags
                    <span className="font-normal text-amber-600/70 ml-1">(hover for details)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {property.redFlags!.map((flag) => {
                      const severity = RED_FLAG_SEVERITY[flag] ?? 3;
                      const desc = RED_FLAG_DESCRIPTIONS[flag];
                      return (
                        <span
                          key={flag}
                          title={desc ? `${desc} (severity ${severity}/5)` : undefined}
                          className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700 font-medium cursor-help"
                        >
                          {RED_FLAG_LABELS[flag]}
                          <span className="ml-1 text-amber-500">{'•'.repeat(severity)}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {(property.aiTags?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-purple-800 mb-1.5">
                    Tags
                    <span className="font-normal text-purple-600/70 ml-1">(hover for details)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {property.aiTags!.map((tag) => {
                      const desc = AI_TAG_DESCRIPTIONS[tag];
                      return (
                        <span
                          key={tag}
                          title={desc || undefined}
                          className="rounded-full bg-white border border-purple-200 px-2 py-0.5 text-xs text-purple-700 font-medium cursor-help"
                        >
                          {AI_TAG_LABELS[tag]}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-700">AI Analysis</h3>
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded font-medium uppercase tracking-wide">
                  Not Yet Analyzed
                </span>
              </div>
              <p className="text-xs text-gray-500">
                This listing hasn&apos;t been through the AI enrichment pass yet. Run{' '}
                <code className="px-1 py-0.5 bg-white border border-gray-200 rounded">
                  ./scripts/refresh_ai.sh
                </code>{' '}
                locally to generate tags, a fit score, red flags, and a plain- language summary.
              </p>
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

          {/* Parcel research — govt enrichment + external links */}
          <ResearchPanel
            location={property.location}
            geo={property.geoEnrichment}
            links={property.externalLinks}
          />

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
            {property.daysOnMarket != null && (
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
                href={safeUrl(property.url)}
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
                  <span className="text-xs text-green-600 font-medium whitespace-nowrap">
                    Copied!
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Reaction row + Add-to-project sit above the Save/Hide bar.
              Three preference axes from light to heavy commitment:
              rating (lightest, just preference signal), bookmark+hide
              (action), project (work-tracking). */}
          {user && (
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <RatingBar listingId={property.id} />
              <div className="flex items-center justify-end">
                <AddToProjectButton itemType="listing" itemId={property.id} />
              </div>
            </div>
          )}
          <div className="border-t border-gray-100 pt-4 flex items-center gap-2">
            <button
              onClick={() => {
                if (!user) {
                  void loginWithGoogle();
                  return;
                }
                void toggleSaved(property.id);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                saved
                  ? 'bg-amber-400 border-amber-500 text-white hover:bg-amber-500'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
              {saved ? 'Saved' : 'Save'}
            </button>
            {user && (
              <button
                onClick={() => void toggleHidden(property.id)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  hidden
                    ? 'bg-red-500 border-red-600 text-white hover:bg-red-600'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title={hidden ? 'Hidden — click to restore' : 'Not interested'}
              >
                {hidden ? (
                  <>
                    {/* Eye-off — reflects CURRENT state: this listing is
                        hidden from the default list. Clicking restores. */}
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    Hidden — show again
                  </>
                ) : (
                  <>
                    {/* Open eye — listing is visible. Clicking hides. */}
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Not interested
                  </>
                )}
              </button>
            )}
          </div>

          {/* Private note (renders only when saved) */}
          <PrivateNote listingId={property.id} />

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
              href={safeUrl(property.url)}
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
