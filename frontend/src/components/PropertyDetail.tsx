import { Lock } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Property, FEATURE_LABELS } from '../types/property';
import { useAccessTier } from '../hooks/useAccessTier';
import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { FreeTierLimitError, useSavedListings } from '../hooks/useSavedListings';
import { AddToProjectButton } from './AddToProjectButton';
import { CadRecordPanel } from './CadRecord';
import { CompBreakdown } from './CompBreakdown';
// Lazy-load the mini-map: Leaflet + react-leaflet are ~80KB gzip
// of bundle that the detail page doesn't need until paint settles.
const PropertyMiniMap = lazy(() =>
  import('./PropertyMiniMap').then((m) => ({ default: m.PropertyMiniMap })),
);
import { DealScoreBreakdown } from './DealScoreBreakdown';
import { HomesteadFitBreakdown } from './HomesteadFitBreakdown';
import { InvestmentScorePanel } from './InvestmentScore';
import { MarketContext } from './MarketContext';
import { PrivateNote } from './PrivateNote';
import { PropertyThumbnail } from './PropertyThumbnail';
import { RatingBar } from './RatingBar';
import { ResearchPanel } from './ResearchPanel';
import { UpgradeModal } from './UpgradeModal';
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
  /** Called when the user clicks the back arrow. Always navigates
   * one step back in history at the route level. */
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
  const { canSeeSourceLinks } = useAccessTier();
  const { isSaved, toggle: toggleSaved } = useSavedListings();
  const { isHidden, toggle: toggleHidden } = useHiddenListings();
  const saved = isSaved(property.id);
  const hidden = isHidden(property.id);
  const [showUpgrade, setShowUpgrade] = useState(false);

  /** Save click handler — same pattern as PropertyCard. Anonymous
   * users get Google OAuth; free-tier users at the 5-save limit
   * see the upgrade modal instead of a silent failure. */
  const onSaveClick = async () => {
    if (!user) {
      void loginWithGoogle();
      return;
    }
    try {
      await toggleSaved(property.id);
    } catch (err) {
      if (err instanceof FreeTierLimitError) {
        setShowUpgrade(true);
        return;
      }
      throw err;
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(property.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    // Renders inline within the AppShell main column at /p/:id.
    <div className="p-0 sm:p-4">
      <div className="relative bg-white w-full sm:max-w-3xl sm:rounded-xl shadow-sm sm:shadow border border-gray-200 mx-auto">
        {/* Sticky back-button anchor — zero-height sticky container
            keeps the absolutely-positioned button pinned to the top
            of the viewport as the user scrolls. Dark-glass backdrop
            so it stays legible over both the hero image and the
            white content below. */}
        <div className="sticky top-0 z-20 h-0">
          <button
            onClick={onClose}
            aria-label="Back"
            className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white text-lg leading-none flex items-center justify-center transition-colors shadow-lg"
          >
            ‹
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

          {/* Three composite scores stacked together so the user sees
              the headline numbers first, in one visual rhythm. Each
              panel matches the same Ring + breakdown grammar so the
              eye groups them.
                Deal Score      → Star,  4-axis (price/features/dom/source)
                Investment      → $,     5-axis (value/land/risk/liquidity/macro)
                Homestead Fit   → Leaf,  AI tags + red flags
              Color-banded green/amber/red by score so a green Deal
              and an amber Fit on the same listing read instantly. */}
          <DealScoreBreakdown property={property} />
          <InvestmentScorePanel property={property} />

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
                    linear miles on rural back roads.
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

          {/* Homestead Fit panel — same visual grammar as Deal Score
              and Investment Score so all three composite scores read
              as a unified set. AI-extracted tags + red flags. Falls
              through to a small "not analyzed yet" block when the
              AI enrichment pass hasn't run. */}
          {property.enrichedAt ? (
            <HomesteadFitBreakdown property={property} />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-700">Homestead Fit</h3>
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

          {/* Inline map of the parcel + nearest comp listings. Gives
              the user "where am I actually looking" before they read
              the comp breakdown. Lazy-loaded so the Leaflet bundle
              doesn't ship to detail pages that aren't viewed. */}
          <Suspense
            fallback={
              <div className="rounded-xl border border-gray-200 bg-gray-50 h-64 flex items-center justify-center text-xs text-gray-400">
                Loading map…
              </div>
            }
          >
            <PropertyMiniMap property={property} />
          </Suspense>

          {/* "How we computed the comp" — surfaces the methodology +
              the actual listings that fed the median, so users can
              audit the comparison instead of trusting an opaque number. */}
          <CompBreakdown property={property} />

          {/* Travis CAD record — owner, last deed date, valuations
              from the public county appraisal roll. Self-gates on
              `data/cad_joined.json` having a row for this listing
              (currently Travis-only; other counties as we add them). */}
          <CadRecordPanel property={property} />

          {/* Property-as-a-stock — county / state percentile + voting
              chip. Different signal from CompBreakdown (which is just
              the $/ac comparison). Self-gates on comp depth. */}
          <MarketContext property={property} />

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

          {/* Listing URL — gated for anonymous viewers. We deliberately
              do NOT expose the source URL or its host name when the
              user isn't signed in: combined with title + county +
              acreage already on the page, it would be enough to
              re-find the listing on the source site and bypass the
              signup funnel entirely. */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-gray-500 text-xs mb-1">Listing URL</p>
            {canSeeSourceLinks ? (
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
            ) : (
              <button
                type="button"
                onClick={() => void loginWithGoogle()}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-sm font-medium px-3 py-2 w-full"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                Sign up free to view the source listing
              </button>
            )}
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
              onClick={() => void onSaveClick()}
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
            {canSeeSourceLinks ? (
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
            ) : (
              <button
                type="button"
                onClick={() => void loginWithGoogle()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold py-3"
              >
                <Lock className="w-4 h-4" aria-hidden="true" />
                Sign up free to view this listing
              </button>
            )}
          </div>
        </div>
      </div>
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        reason="saved_listings_limit"
      />
    </div>
  );
};
