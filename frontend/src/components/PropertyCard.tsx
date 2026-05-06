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
import { useMemo, useState } from 'react';
import { useCompsCorpus } from '../hooks/useCountyMedians';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useListingRatings } from '../hooks/useListingRatings';
import { useSavedListings, FreeTierLimitError } from '../hooks/useSavedListings';
import { Droplet, Home, Leaf, Shield, Wheat, Zap } from 'lucide-react';
import { findBestComps, formatVsComp, rawLandPpa } from '../utils/comps';
import { computeSelfSufficiency, AxisKey } from '../utils/selfSufficiency';
import { InvestmentScoreBadge, Ring, ScoreRingChip, tier, tierClasses } from './InvestmentScore';
import { UpgradeModal } from './UpgradeModal';
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
import { getDealScoreBorderColor } from '../utils/scoring';

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
  const scoreBorder = getDealScoreBorderColor(property.dealScore);
  const typeStyle = getListingTypeStyle(property);
  const { user, loginWithGoogle } = useAuth();
  const { isSaved, toggle } = useSavedListings();
  const { isHidden, toggle: toggleHidden } = useHiddenListings();
  const { getRating } = useListingRatings();
  const saved = isSaved(property.id);
  const hidden = isHidden(property.id);
  const rating = getRating(property.id);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Self-Sufficiency report — the new headline. Memoized per card so
  // the 5-axis breakdown only computes once per Property mount.
  const ssReport = useMemo(() => computeSelfSufficiency(property), [property]);

  // "vs comp" cue near the price. Walks a tightest-first fallback
  // chain so the displayed % reflects similar parcels first
  // (acreage-band within county → nearby within 25mi → county). The
  // tooltip explains which pool we used so users can tell a tight
  // neighborhood number from a county-wide one. Hides when no pool
  // has ≥ 5 comps (better "no comps" than a 2-row median).
  const compsCorpus = useCompsCorpus();
  const comp = useMemo(
    () => findBestComps(property, compsCorpus),
    [property, compsCorpus],
  );
  // Compare raw-land $/ac (residual minus structures + utilities) on
  // both sides — the median in `comp` was also computed from raw-land
  // values, so this is an apples-to-apples comparison.
  const vsMedian = formatVsComp(rawLandPpa(property), comp);

  const onSaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      void loginWithGoogle();
      return;
    }
    try {
      await toggle(property.id);
    } catch (err) {
      if (err instanceof FreeTierLimitError) {
        setShowUpgrade(true);
        return;
      }
      throw err;
    }
  };

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
        onClick={onSaveClick}
        aria-label={saved ? 'Remove from saved' : 'Save listing'}
        title={
          user
            ? saved
              ? 'Saved — click to remove'
              : 'Save this listing'
            : 'Sign in to save listings'
        }
        className={`absolute top-2 right-2 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow ${
          saved
            ? 'bg-amber-400 hover:bg-amber-500 text-white'
            : 'bg-black/60 hover:bg-black/75 text-white'
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
          className={`absolute top-2 right-11 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow ${
            hidden
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-black/60 hover:bg-black/75 text-white'
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
      {/* Rating indicator — small emoji badge in the top-LEFT, away
          from the save/hide buttons in the top-right. Only renders
          when the user has actually rated this listing. Click opens
          the detail modal where the full RatingBar lives; we don't
          surface the 5-button picker on the card to avoid clutter. */}
      {/* Top-left of the photo: our Deal Score badge + (optional)
          user rating, stacked. Deal Score is the headline signal we
          want users to read first, so it goes on the image (same
          convention as the Top Picks carousel rank badge).
          InvestmentScore + Homestead Fit stay in the inline pill row
          below the title. */}
      {/* iOS Safari: avoid `backdrop-blur` on these overlay chips —
          it forces them onto a compositor layer that escapes the
          parent scroll container's clipping during momentum-scroll,
          so the chip visually floats over the page header. Solid
          `bg-white` is fine over a photo and fixes the bug. */}
      <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1.5">
        {/* Self-Sufficiency ring — autonomy-first headline replacing
            the old Deal Score ring. Number-only inside the ring so
            the score reads at a glance; tier color follows the same
            green/amber/rose bands as the InvestmentScore palette. */}
        <div
          className="rounded-full bg-white shadow p-1"
          title={`Self-Sufficiency: ${ssReport.composite}/100 — ${ssReport.weakest.label} is the bottleneck (${ssReport.weakest.score})`}
        >
          <Ring score={ssReport.composite} size={36} strokeWidth={4}>
            <span className="text-[11px] font-bold tabular-nums">
              {ssReport.composite}
            </span>
          </Ring>
        </div>
        {rating !== 0 && (
          <div
            className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-sm shadow"
            title={
              rating === 2
                ? '😄 Loved'
                : rating === 1
                  ? '🙂 Liked'
                  : rating === -1
                    ? '🙁 Disliked'
                    : '😡 Hated'
            }
            aria-label="Your rating"
          >
            {rating === 2 ? '😄' : rating === 1 ? '🙂' : rating === -1 ? '🙁' : '😡'}
          </div>
        )}
      </div>
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
              {/* Two score pills inline next to the title. Deal Score
                  was promoted to the photo overlay top-left so it's
                  the first thing the eye lands on; InvestmentScore +
                  Homestead Fit stay here as the secondary read.
                    💲 DollarSign → Investment
                    🌱 Leaf     → Homestead Fit */}
              {property.investmentScore !== undefined && (
                <InvestmentScoreBadge score={property.investmentScore} />
              )}
              {property.homesteadFitScore !== undefined ? (
                <ScoreRingChip
                  score={property.homesteadFitScore}
                  icon={Leaf}
                  label={
                    property.aiSummary
                      ? `Homestead Fit — ${property.aiSummary}`
                      : 'Homestead Fit'
                  }
                  variant="flat"
                />
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200"
                  title="Homestead Fit not yet AI-analyzed"
                >
                  <Leaf className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                </span>
              )}
            </div>
            <ValidationBadge status={property.status} />
          </div>
        </div>

        {/* Self-Sufficiency axis strip — Food / Water / Energy / Shelter
            / Resilience as 5 mini bars. Makes the autonomy profile
            glanceable at card scale. The bottleneck axis is also the
            tooltip on the photo's SS ring so users can mouse-over for
            "what's holding this back". */}
        <div className="mt-2 space-y-0.5">
          {ssReport.axes.map((axis) => (
            <SsAxisBar key={axis.key} axisKey={axis.key} score={axis.score} label={axis.label} />
          ))}
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
              {/* Price + $/acre as twin headlines — both are the value
                  signals buyers actually compare across listings. The
                  acreage and county-comp delta sit underneath as smaller
                  sublines. The redundant "Hot Deal / Below Avg" label
                  was dropped because the dealScore ring overlay already
                  shows the canonical number. */}
              <div>
                <p className="text-lg font-bold text-gray-900">{formatPrice(property.price)}</p>
                <p className="text-xs text-gray-500">{formatAcreage(property.acreage)}</p>
              </div>
              <div className="text-gray-300">|</div>
              <div>
                {/* Residual $/acre when we detected structures worth subtracting
                    — a cabin-on-40ac listing should show the land-only $/ac
                    alongside the raw number, otherwise buyers can't compare
                    to bare parcels. */}
                {property.residualPricePerAcre &&
                property.estimatedStructureValueUsd &&
                property.estimatedStructureValueUsd > 0 ? (
                  <p
                    className="text-base font-semibold text-gray-700"
                    title={`Land-only $/ac after subtracting ~${formatPrice(property.estimatedStructureValueUsd)} estimated structure value`}
                  >
                    {formatPricePerAcre(property.residualPricePerAcre)}
                    <span className="text-[10px] text-gray-400 font-medium ml-1">/ac (land)</span>
                  </p>
                ) : (
                  <p className="text-base font-semibold text-gray-700">
                    {formatPricePerAcre(property.pricePerAcre)}
                    <span className="text-[10px] text-gray-400 font-medium ml-1">/ac</span>
                  </p>
                )}
                {vsMedian ? (
                  <p
                    className={`text-xs mt-0.5 font-medium ${
                      vsMedian.startsWith('at')
                        ? 'text-gray-500'
                        : vsMedian.includes('below')
                          ? 'text-emerald-700'
                          : 'text-orange-700'
                    }`}
                    title={`Median $/ac: ${formatPricePerAcre(comp?.median ?? 0)} — ${comp?.poolLabel ?? ''}`}
                  >
                    {vsMedian}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">no comps</p>
                )}
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
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        reason="saved_listings_limit"
      />
    </div>
  );
};

// ── SS axis mini-bar (per-card autonomy strip) ───────────────────────

const AXIS_ICON: Record<AxisKey, React.ComponentType<{ className?: string }>> = {
  food: Wheat,
  water: Droplet,
  energy: Zap,
  shelter: Home,
  resilience: Shield,
};

const SsAxisBar = ({
  axisKey,
  score,
  label,
}: {
  axisKey: AxisKey;
  score: number;
  label: string;
}) => {
  const klass = tierClasses[tier(score)];
  const Icon = AXIS_ICON[axisKey];
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}: ${score}/100`}
    >
      <Icon className={`w-3 h-3 flex-shrink-0 ${klass.text}`} />
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${klass.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-[10px] font-bold tabular-nums w-5 text-right ${klass.text}`}>
        {score}
      </span>
    </div>
  );
};
