import { Property, FEATURE_LABELS } from '../types/property';

/**
 * Human labels for the improvement keys `scraper/improvements.py`
 * emits. Keeping this here (not in types/property.ts) so the label
 * copy can evolve per-surface without touching the data contract —
 * the detail modal or map popups might use different wording later.
 */
const IMPROVEMENT_LABELS: Record<string, string> = {
  home: 'House',
  cabin: 'Cabin',
  barn: 'Barn',
  outbuilding: 'Outbuilding',
  well: 'Well',
  septic: 'Septic',
  electric: 'Electric',
  water_city: 'City water',
};

/** Rough days-on-market estimate from dateFound when the source
 * didn't supply a firm number. Returns null for unparseable dates or
 * future-dated rows (clock skew). Used as a negotiation signal —
 * precision within a few days is fine. */
const computeDaysOnMarket = (isoDate: string): number | null => {
  if (!isoDate) return null;
  const found = new Date(isoDate).getTime();
  if (!Number.isFinite(found)) return null;
  const diffDays = Math.floor((Date.now() - found) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : null;
};

import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useSavedListings } from '../hooks/useSavedListings';
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
        ✗ Sold
      </span>
    );
  }
  if (s === 'pending') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-700">
        ⟳ Pending
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
  const { user, loginWithGoogle } = useAuth();
  const { isSaved, toggle } = useSavedListings();
  const { isHidden, toggle: toggleHidden } = useHiddenListings();
  const saved = isSaved(property.id);
  const hidden = isHidden(property.id);

  return (
    <div
      className={`relative rounded-lg border-2 bg-white cursor-pointer transition-all hover:shadow-md overflow-hidden ${
        isSelected ? `${scoreBorder} shadow-md` : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={() => onClick(property.id)}
    >
      {/* Bookmark button — floats over the top-right corner of the
          thumbnail. Prompts login when clicked anonymously (Google
          OAuth round-trip via useAuth). Optimistic-update semantics
          inherited from useSavedListings. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!user) {
            // Anonymous click on the bookmark → quickest path to login
            // is Google (one tap). If that user would rather use email
            // they can hit Sign-in in the header and see the full sheet.
            void loginWithGoogle();
            return;
          }
          void toggle(property.id);
        }}
        aria-label={saved ? 'Remove from saved' : 'Save listing'}
        title={
          user
            ? saved
              ? 'Saved — click to remove'
              : 'Save this listing'
            : 'Sign in to save listings'
        }
        className={`absolute top-2 right-2 z-10 w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors shadow ${
          saved
            ? 'bg-amber-400/90 hover:bg-amber-500 text-white'
            : 'bg-black/40 hover:bg-black/60 text-white'
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
      </button>
      {/* "Not interested" button — sits just left of the bookmark.
          Only surfaced when signed in (anonymous users would have
          nowhere to persist the signal). Feeds the personalization
          model in rank_fit.py as a clean negative example. */}
      {user && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void toggleHidden(property.id);
          }}
          aria-label={hidden ? 'Un-hide listing' : 'Not interested'}
          title={hidden ? 'Hidden — click to restore' : 'Not interested'}
          className={`absolute top-2 right-11 z-10 w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors shadow ${
            hidden
              ? 'bg-red-500/90 hover:bg-red-600 text-white'
              : 'bg-black/40 hover:bg-black/60 text-white'
          }`}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {hidden ? (
              // Eye-off — reflects CURRENT state: this listing is hidden
              // from the default list. Clicking restores visibility.
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </>
            ) : (
              // Open eye — reflects CURRENT state: listing is visible.
              // Clicking hides it from the default list.
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      )}
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
                {/* Residual $/acre when we detected structures worth subtracting
                    — a cabin-on-40ac listing should show the land-only $/ac
                    alongside the raw number, otherwise buyers can't compare to
                    bare parcels. Falls back to regular $/ac for bare land. */}
                {property.residualPricePerAcre &&
                property.estimatedStructureValueUsd &&
                property.estimatedStructureValueUsd > 0 ? (
                  <p
                    className="text-xs text-gray-500"
                    title={`Land-only $/ac after subtracting ~${formatPrice(property.estimatedStructureValueUsd)} estimated structure value`}
                  >
                    {formatPricePerAcre(property.residualPricePerAcre)}{' '}
                    <span className="text-gray-400">(land)</span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">{formatPricePerAcre(property.pricePerAcre)}</p>
                )}
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

        {/* Improvement chips — "what's already here". Surfaces detected
            structures (home/cabin/barn) and utilities (well/septic/electric).
            Move-in-ready trumps individual chips with a single prominent
            badge so users can spot livable listings at a glance. */}
        {property.moveInReady ? (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            🏠 Move-in Ready
          </div>
        ) : property.improvements && Object.keys(property.improvements).length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.keys(property.improvements).slice(0, 4).map((key) => (
              <span
                key={key}
                className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 border border-blue-200 capitalize"
                title={`Detected in listing text — ~$${(property.estimatedStructureValueUsd ?? 0).toLocaleString()} total estimated structure/utility value`}
              >
                {IMPROVEMENT_LABELS[key] ?? key}
              </span>
            ))}
          </div>
        ) : null}

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

        {/* Bottom meta row: date + DOM badge + nearest town distance.
            Days-on-market badge is a negotiation signal — new listings
            (< 7d) are usually priced firm; stale listings (> 90d) often
            open to offers. Only shown when we have provenance (either
            an explicit daysOnMarket or a reliable dateFound difference). */}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span>{formatDaysAgo(property.dateFound)}</span>
            {(() => {
              const dom = property.daysOnMarket ?? computeDaysOnMarket(property.dateFound);
              if (dom === null || dom < 14) return null;
              if (dom >= 180) {
                return (
                  <span
                    className="rounded bg-orange-50 border border-orange-200 px-1 py-0 text-[10px] font-medium text-orange-700"
                    title="Listed 180+ days ago — often negotiable, but investigate why it hasn't sold"
                  >
                    {dom}d on market
                  </span>
                );
              }
              if (dom >= 60) {
                return (
                  <span
                    className="rounded bg-yellow-50 border border-yellow-200 px-1 py-0 text-[10px] font-medium text-yellow-700"
                    title="60+ days on market — may be open to offers"
                  >
                    {dom}d on market
                  </span>
                );
              }
              return null;
            })()}
          </span>
          {property.geoEnrichment?.proximity?.nearestTownName &&
            property.geoEnrichment.proximity.nearestTownDistanceMiles !== undefined && (
              <span
                title={`Nearest town ≥5k: ${property.geoEnrichment.proximity.nearestTownName}${
                  property.geoEnrichment.proximity.nearestTownPopulation
                    ? ` (pop ${property.geoEnrichment.proximity.nearestTownPopulation.toLocaleString()})`
                    : ''
                }`}
              >
                📍 {property.geoEnrichment.proximity.nearestTownDistanceMiles.toFixed(0)} mi to{' '}
                {property.geoEnrichment.proximity.nearestTownName}
              </span>
            )}
        </div>
      </div>
    </div>
  );
};
