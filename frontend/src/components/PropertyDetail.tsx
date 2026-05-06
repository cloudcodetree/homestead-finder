import { lazy, Suspense, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Wheat,
  Droplet,
  Zap,
  Home,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
} from 'lucide-react';
import { usePropertyDetail } from '../hooks/usePropertyDetail';
import { useCadRecord } from '../hooks/useCadRecord';
import { useAuth } from '../hooks/useAuth';
import { useAccessTier } from '../hooks/useAccessTier';
import { useSavedListings } from '../hooks/useSavedListings';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useListingRatings } from '../hooks/useListingRatings';
import {
  AI_TAG_DESCRIPTIONS,
  AI_TAG_LABELS,
  Property,
  RED_FLAG_DESCRIPTIONS,
  RED_FLAG_LABELS,
  RED_FLAG_SEVERITY,
} from '../types/property';
import {
  formatAcreage,
  formatCountyState,
  formatDate,
  formatPrice,
  formatSourceName,
} from '../utils/formatters';
import { safeUrl } from '../utils/safeUrl';
import { getListingTypeStyle } from '../utils/listingType';
import { Ring, tier, tierClasses } from './InvestmentScore';
import { CompBreakdown } from './CompBreakdown';
import { MarketContext } from './MarketContext';
import { PropertyThumbnail } from './PropertyThumbnail';
import { AddToProjectButton } from './AddToProjectButton';
import { PrivateNote } from './PrivateNote';
import {
  Axis,
  AxisKey,
  computeSelfSufficiency,
  Gap,
} from '../utils/selfSufficiency';

// Real Leaflet mini-map — lazy so the preview chunk stays small.
const PropertyMiniMap = lazy(() =>
  import('./PropertyMiniMap').then((m) => ({ default: m.PropertyMiniMap })),
);

// ── ValidationBadge — small status pill (active / expired / pending /
//    tax_sale / unverified). Same set the production PropertyDetail
//    surfaces top-right of the listing header.
const ValidationBadge = ({ status }: { status?: Property['status'] }) => {
  const s = status ?? 'unverified';
  const map: Record<string, { bg: string; text: string; label: string }> = {
    active:    { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: '✓ Verified' },
    expired:   { bg: 'bg-rose-50 border-rose-200',       text: 'text-rose-700',    label: '✗ Sold' },
    pending:   { bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    label: '⟳ Pending' },
    tax_sale:  { bg: 'bg-orange-50 border-orange-300',   text: 'text-orange-700',  label: '⚖ Tax sale' },
    unverified:{ bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   label: '⚠ Unverified' },
  };
  const t = map[s] ?? map.unverified;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${t.bg} ${t.text}`}>
      {t.label}
    </span>
  );
};

/**
 * Redesigned property-detail page with **Self-Sufficiency** as the
 * spine. Replaces the multi-score "researcher" framing with one
 * question: how close is this parcel to fully autonomous living?
 *
 * Axes (all derived from existing geoEnrichment + features):
 *   Food · Water · Energy · Shelter · Resilience
 *
 * The buildout calculator answers "what does it cost to close every
 * gap" — not "how long does my retirement money last."
 *
 * Mounts at /preview/redesigned-detail/:id? alongside production
 * /p/:id so the two can be compared side-by-side.
 */
export const PropertyDetail = () => {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const id = idParam ?? searchParams.get('id') ?? 'landhub_75707376';
  // Two-tier load: slim index gives us SOMETHING immediately so the
  // page doesn't flash a spinner; per-id detail file (`data/listings/
  // <id>.json` from `scraper/shard_listings.py`) hydrates the heavy
  // detail-only fields (geoEnrichment, full description, AI summary,
  // investmentBreakdown axes, votingPattern, full taxSale) when the
  // chunk lands.
  const { property, loading } = usePropertyDetail(id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (!property) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        Listing <code>{id}</code> not in corpus.
      </div>
    );
  }

  return <PreviewBody property={property} />;
};

const PreviewBody = ({ property }: { property: Property }) => {
  const report = useMemo(() => computeSelfSufficiency(property), [property]);
  const cad = useCadRecord(property.id);
  const [showFinancialLens, setShowFinancialLens] = useState(false);
  const { user } = useAuth();

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 pb-32 space-y-4">
      <StickyHeader property={property} />
      <Hero property={property} report={report} />
      <BuildoutToAutonomy property={property} report={report} />
      <AboutListing property={property} />

      {/* Five autonomy axes */}
      <FoodPanel property={property} axis={report.axes.find((a) => a.key === 'food')!} />
      <WaterPanel property={property} axis={report.axes.find((a) => a.key === 'water')!} />
      <EnergyPanel axis={report.axes.find((a) => a.key === 'energy')!} />
      <ShelterPanel property={property} axis={report.axes.find((a) => a.key === 'shelter')!} />
      <ResilienceAndRegulatory property={property} axis={report.axes.find((a) => a.key === 'resilience')!} />

      {/* Real Leaflet map (subject + nearest comps) */}
      <Suspense
        fallback={
          <div className="rounded-xl border border-gray-200 bg-gray-50 h-64 flex items-center justify-center text-xs text-gray-400">
            Loading map…
          </div>
        }
      >
        <PropertyMiniMap property={property} />
      </Suspense>

      {/* Restored: comp breakdown — the investment thesis engine */}
      <CompBreakdown property={property} />

      <HomesteadCommunity />
      <CountyRecords cad={cad} />

      {/* Restored: state percentile + county voting chip */}
      <MarketContext property={property} />

      {/* All outbound research/data links in one sources panel */}
      <ResearchLinks property={property} />

      {/* Financial lens hides Deal/Investment/Fit by default */}
      <FinancialLens
        property={property}
        open={showFinancialLens}
        onToggle={() => setShowFinancialLens((v) => !v)}
      />

      {/* Private note (paid-tier feature; component self-gates) */}
      {user && <PrivateNote listingId={property.id} />}

      {/* Provenance footer */}
      <ListingProvenance property={property} />

      <ActionBar property={property} />
    </div>
  );
};

// ── Tax-sale subtitle ─────────────────────────────────────────────────

const REDEMPTION_BLURB: Record<NonNullable<Property['taxSale']>['stateType'] & string, string> = {
  lien: 'Lien certificate auction · winning bidder collects redemption interest',
  deed: 'Title at auction · NO right of redemption',
  redeemable_deed: 'Title at auction · 180-day redemption (2 yr if homestead)',
  hybrid: 'Hybrid sale · early offerings lien-style, later convert to deed',
};

const SALE_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TaxSaleSubtitle = ({ property }: { property: Property }) => {
  const ts = property.taxSale!;
  const minBid = ts.amountOwedUsd ?? 0;
  const apprUsd = ts.estimatedValueUsd ?? 0;
  const multiple = ts.investmentMultiple;
  return (
    <div className="mt-1 space-y-1">
      <p className="text-sm text-gray-500">
        {formatCountyState(property.location.county, property.location.state)}{' '}
        {property.acreage > 0 && <>· {formatAcreage(property.acreage)}</>}
      </p>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-base font-bold text-orange-700 tabular-nums">
          {formatPrice(minBid)}
        </span>
        <span className="text-xs text-gray-500">min bid (back taxes owed)</span>
        {apprUsd > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-600">
              county-appraised{' '}
              <span className="font-semibold tabular-nums">{formatPrice(apprUsd)}</span>
            </span>
          </>
        )}
        {multiple != null && multiple > 1 && (
          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0 text-[10px] font-bold text-emerald-700 tabular-nums">
            {multiple.toFixed(1)}× upside
          </span>
        )}
      </div>
      <p className="text-[11px] text-orange-700">
        {ts.stateType ? REDEMPTION_BLURB[ts.stateType] : 'Tax sale — redemption rules vary by state'}
        {ts.saleMonth && (
          <>
            {' · '}
            sale typically held in{' '}
            <span className="font-semibold">{SALE_MONTH[ts.saleMonth - 1] ?? '—'}</span>
          </>
        )}
      </p>
    </div>
  );
};

// ── Sticky scroll header ─────────────────────────────────────────────

/**
 * Pinned title strip that appears as the user scrolls past the hero.
 * Mirrors the production sticky header on /p/<id>. z-20 keeps it
 * above the autonomy axis cards but below the AppShell global header.
 */
const StickyHeader = ({ property }: { property: Property }) => (
  <div className="sticky top-0 z-20 -mx-3 sm:-mx-6 mb-2 px-3 sm:px-6 py-2 bg-white/90 backdrop-blur-sm border-b border-gray-100">
    <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
      <p className="text-sm font-semibold text-gray-900 truncate">
        {property.title}
      </p>
      <p className="text-sm font-bold text-gray-700 flex-shrink-0 tabular-nums">
        {formatPrice(property.price)} · {formatAcreage(property.acreage)}
      </p>
    </div>
  </div>
);

// ── Hero with composite + 5 axis bars ─────────────────────────────────

const AXIS_ICON: Record<AxisKey, React.ReactNode> = {
  food: <Wheat className="w-3.5 h-3.5" />,
  water: <Droplet className="w-3.5 h-3.5" />,
  energy: <Zap className="w-3.5 h-3.5" />,
  shelter: <Home className="w-3.5 h-3.5" />,
  resilience: <Shield className="w-3.5 h-3.5" />,
};

const Hero = ({
  property,
  report,
}: {
  property: Property;
  report: ReturnType<typeof computeSelfSufficiency>;
}) => {
  const klass = tierClasses[tier(report.composite)];
  const { user, loginWithGoogle } = useAuth();
  const { getRating, setRating } = useListingRatings();
  const rating = getRating(property.id);
  const typeStyle = getListingTypeStyle(property);

  // Thumbs map onto the existing 5-emoji rating scale
  // (-2/-1/0/1/2). Up = +1 ("liked"), Down = -1 ("disliked"). One tap
  // toggles, second tap clears (matches the emoji bar pattern).
  const onThumb = (kind: 'up' | 'down') => async () => {
    if (!user) {
      void loginWithGoogle();
      return;
    }
    const target = kind === 'up' ? 1 : -1;
    await setRating(property.id, rating === target ? null : target);
  };

  return (
    <section className={`rounded-xl border ${klass.border} ${klass.bg} overflow-hidden`}>
      {/* Listing-type accent stripe (color bar above photo) — same
          signal as PropertyCard. Tax-sale orange, owner-finance blue,
          standard for-sale green, etc. */}
      <div className={`h-1 ${typeStyle.accentBar}`} aria-hidden="true" />

      {/* Real photo banner via PropertyThumbnail (gallery support).
          Thumbs overlay top-right, wired to useListingRatings so the
          signal trains rank_fit per ADR-012. */}
      <div className="relative">
        <PropertyThumbnail
          property={property}
          width={768}
          className="w-full h-44 sm:h-56"
        />
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Like"
            title={user ? (rating === 1 ? 'Liked — click to clear' : 'Like') : 'Sign in to rate'}
            onClick={onThumb('up')}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow transition-colors ${
              rating === 1
                ? 'bg-emerald-500 text-white'
                : 'bg-white/95 text-gray-700 hover:bg-white'
            }`}
          >
            <ThumbsUp className="w-4 h-4" fill={rating === 1 ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            aria-label="Dislike"
            title={user ? (rating === -1 ? 'Disliked — click to clear' : 'Dislike') : 'Sign in to rate'}
            onClick={onThumb('down')}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow transition-colors ${
              rating === -1
                ? 'bg-rose-500 text-white'
                : 'bg-white/95 text-gray-700 hover:bg-white'
            }`}
          >
            <ThumbsDown className="w-4 h-4" fill={rating === -1 ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight flex-1 min-w-0">
                {property.title}
              </h1>
              <ValidationBadge status={property.status} />
            </div>
            {property.status === 'tax_sale' && property.taxSale ? (
              <TaxSaleSubtitle property={property} />
            ) : (
              <p className="text-sm text-gray-500 mt-0.5">
                {formatCountyState(property.location.county, property.location.state)} ·{' '}
                {formatAcreage(property.acreage)} · {formatPrice(property.price)}
              </p>
            )}
            {property.moveInReady && (
              <span className="inline-flex items-center gap-1 mt-1.5 rounded-full bg-emerald-100 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                🏠 Move-in ready
              </span>
            )}
          </div>
          <div className="flex flex-col items-center flex-shrink-0">
            <Ring score={report.composite} size={84} strokeWidth={9}>
              <span className="text-base font-bold">{report.composite}</span>
            </Ring>
            <p className="mt-1 text-xs font-semibold text-gray-700 whitespace-nowrap">
              Self-Sufficiency
            </p>
          </div>
        </div>

        {/* Five axis bars */}
        <div className="mt-3 space-y-1.5">
          {report.axes.map((axis) => (
            <AxisBar key={axis.key} axis={axis} />
          ))}
        </div>

        {/* The thing to worry about */}
        <div className="mt-3 rounded-md bg-white border border-gray-200 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-700">
            <span className="font-semibold">{report.weakest.label} is the bottleneck</span> —{' '}
            {report.weakest.verdict}
          </p>
        </div>
      </div>
    </section>
  );
};

const AxisBar = ({ axis }: { axis: Axis }) => {
  const klass = tierClasses[tier(axis.score)];
  return (
    <div className="flex items-center gap-2">
      <span className={`flex-shrink-0 ${klass.text}`}>{AXIS_ICON[axis.key]}</span>
      <span className="text-xs font-medium text-gray-700 w-20 flex-shrink-0">
        {axis.label}
      </span>
      <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
        <div
          className={`h-full ${klass.bar} transition-[width] duration-500`}
          style={{ width: `${axis.score}%` }}
        />
      </div>
      <span className={`text-sm font-bold tabular-nums w-9 text-right ${klass.text}`}>
        {axis.score}
      </span>
    </div>
  );
};

// ── Buildout-to-Autonomy ──────────────────────────────────────────────

const BuildoutToAutonomy = ({
  property,
  report,
}: {
  property: Property;
  report: ReturnType<typeof computeSelfSufficiency>;
}) => {
  // Tax-sale rows use the min bid (back taxes owed) as the
  // acquisition cost, not the asking-price field. Buildout still
  // closes the same axis gaps regardless of how the parcel was
  // bought.
  const isTaxSale = property.status === 'tax_sale' && property.taxSale;
  const totalAsking = isTaxSale
    ? property.taxSale?.amountOwedUsd ?? 0
    : property.price ?? 0;
  const cost = (report.costToFullLowUsd + report.costToFullHighUsd) / 2;
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <header className="flex items-baseline justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900">Buildout to autonomy</h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">
          Closing the gap
        </span>
      </header>
      <p className="text-xs text-gray-600 mb-3">
        What it would cost to bring every axis to ≥85 (full self-sufficient
        steady state). Numbers are ±50% rules-of-thumb.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
        <Stat label="Today" value={`${report.composite}`} tone="amber" />
        <span className="text-gray-400">→</span>
        <Stat label="After buildout" value={`${report.potentialComposite}`} tone="emerald" />
        <span className="text-gray-400 mx-2">·</span>
        <Stat
          label={isTaxSale ? 'Min bid + buildout' : 'Buy + buildout'}
          value={formatPrice(totalAsking + cost)}
          tone="emerald"
        />
        <span className="text-gray-400 mx-2">·</span>
        <Stat
          label="Range"
          value={`${formatPrice(report.costToFullLowUsd)} – ${formatPrice(report.costToFullHighUsd)}`}
          tone="emerald"
        />
      </div>

      {/* Per-axis gap rows */}
      <div className="space-y-2">
        {report.axes
          .filter((a) => a.score < 85 && a.gaps.length > 0)
          .map((axis) => (
            <div
              key={axis.key}
              className="rounded-md border border-emerald-100 bg-white p-2.5"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-emerald-700">{AXIS_ICON[axis.key]}</span>
                <span className="text-sm font-semibold text-gray-900">{axis.label}</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {axis.score} → ≥85
                </span>
              </div>
              <ul className="space-y-1">
                {axis.gaps.map((gap) => (
                  <GapRow key={gap.label} gap={gap} />
                ))}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
};

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'amber';
}) => {
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-emerald-100 border-emerald-300 text-emerald-900';
  return (
    <span className={`inline-flex flex-col rounded-md border px-2 py-1 ${cls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </span>
  );
};

const GapRow = ({ gap }: { gap: Gap }) => {
  const fmt = (v: number) =>
    v === 0 ? '$0' : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`;
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-gray-700 flex-1">
        <span className="text-emerald-600 font-medium">+{gap.liftPoints}pt</span>{' '}
        {gap.label}
      </span>
      <span className="text-gray-700 font-semibold tabular-nums whitespace-nowrap">
        {fmt(gap.costLowUsd)}–{fmt(gap.costHighUsd)}
      </span>
    </li>
  );
};

// ── Per-axis panels (Food / Water / Energy / Shelter) ─────────────────

const FoodPanel = ({ property, axis }: { property: Property; axis: Axis }) => (
  <AxisPanel
    axis={axis}
    title="Food production"
    subtitle="Can you grow + raise enough to feed yourself?"
  >
    <DetailGrid>
      <DetailItem label="Soil class" value={property.geoEnrichment?.soil?.capabilityClass ?? '—'} />
      <DetailItem label="Drainage" value={property.geoEnrichment?.soil?.drainageClass ?? '—'} />
      <DetailItem label="Slope" value={`${(property.geoEnrichment?.soil?.slopePercent ?? 0).toFixed(1)}%`} />
      <DetailItem
        label="Tillable est."
        value={`${(property.acreage * 0.6).toFixed(1)} ac`}
        hint="60% of total acres typically tillable"
      />
    </DetailGrid>
  </AxisPanel>
);

const WaterPanel = ({ property, axis }: { property: Property; axis: Axis }) => {
  const features = new Set(property.features ?? []);
  return (
    <AxisPanel
      axis={axis}
      title="Water security"
      subtitle="Can you cover all water needs without a municipal hookup?"
    >
      <DetailGrid>
        <DetailItem
          label="Well"
          value={features.has('water_well') ? '✓ on parcel' : 'none'}
        />
        <DetailItem
          label="Surface water"
          value={
            features.has('water_creek')
              ? '✓ creek'
              : features.has('water_pond')
                ? '✓ pond'
                : 'none'
          }
        />
        <DetailItem
          label="Watershed"
          value={property.geoEnrichment?.watershed?.watershedName ?? '—'}
        />
        <DetailItem
          label="Rainwater catchment"
          value="Legal in TX (tax-exempt)"
        />
      </DetailGrid>
    </AxisPanel>
  );
};

const EnergyPanel = ({ axis }: { axis: Axis }) => (
  <AxisPanel
    axis={axis}
    title="Energy autonomy"
    subtitle="Can you generate every kWh on-site?"
  >
    <DetailGrid>
      <DetailItem label="Solar" value="Strong fit · ~$22–55k for 10 kW" />
      <DetailItem label="Wind" value="Skip · TX avg 6–8 mph" />
      <DetailItem label="Hydro" value="Marginal · stream-dependent" />
      <DetailItem label="Geothermal" value="Workable · 1.5+ ac available" />
    </DetailGrid>
  </AxisPanel>
);

const ShelterPanel = ({
  property,
  axis,
}: {
  property: Property;
  axis: Axis;
}) => {
  const improvements = property.improvements ?? {};
  return (
    <AxisPanel
      axis={axis}
      title="Shelter & on-site materials"
      subtitle="What's already built or buildable from this land?"
    >
      <DetailGrid>
        <DetailItem
          label="Existing dwelling"
          value={
            improvements.home
              ? '✓ home'
              : improvements.cabin
                ? '✓ cabin'
                : 'none'
          }
        />
        <DetailItem
          label="Outbuildings"
          value={improvements.barn || improvements.outbuilding ? '✓ present' : 'none'}
        />
        <DetailItem
          label="Septic"
          value={improvements.septic ? '✓ installed' : 'none — $6–14k to add'}
        />
        <DetailItem
          label="Move-in ready"
          value={property.moveInReady ? '✓ yes' : 'no — buildout required'}
        />
      </DetailGrid>
    </AxisPanel>
  );
};

// ── Resilience + Regulatory ───────────────────────────────────────────

const ResilienceAndRegulatory = ({
  property,
  axis,
}: {
  property: Property;
  axis: Axis;
}) => {
  const flood = property.geoEnrichment?.flood;
  const acres = property.acreage ?? 0;
  return (
    <AxisPanel
      axis={axis}
      title="Resilience & regulatory"
      subtitle="What gets in the way of staying off-grid?"
    >
      <DetailGrid>
        <DetailItem
          label="FEMA flood zone"
          value={flood?.floodZone ?? '—'}
          hint={flood?.isSFHA ? '⚠ Special Flood Hazard Area' : undefined}
        />
        <DetailItem
          label="Ag exemption"
          value={acres >= 10 ? 'Eligible (≥10ac)' : 'Below threshold'}
          hint={acres >= 10 ? '~80% TX property-tax cut once filed' : undefined}
        />
        <DetailItem
          label="Water rights"
          value="TX rule of capture"
          hint="Groundwater belongs to the surface owner"
        />
        <DetailItem
          label="HOA"
          value={(property.features ?? []).includes('no_hoa') ? '✓ none' : 'check deed'}
        />
        <DetailItem
          label="Right-to-farm"
          value="TX statute protects ag operations"
        />
        <DetailItem
          label="Wildfire risk"
          value={(property.geoEnrichment?.soil?.slopePercent ?? 0) > 12 ? 'Elevated (steep slope)' : 'Average'}
        />
      </DetailGrid>
    </AxisPanel>
  );
};

// ── Generic axis panel scaffold ───────────────────────────────────────

const AxisPanel = ({
  axis,
  title,
  subtitle,
  children,
}: {
  axis: Axis;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => {
  const klass = tierClasses[tier(axis.score)];
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="flex items-start gap-3 mb-2">
        <Ring score={axis.score} size={48} strokeWidth={5}>
          <span className={klass.text}>{AXIS_ICON[axis.key]}</span>
        </Ring>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </header>
      <p className={`text-sm font-medium ${klass.text} mb-3`}>{axis.verdict}</p>
      {children}
    </section>
  );
};

const DetailGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">{children}</div>
);

const DetailItem = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
    <p className="text-sm font-medium text-gray-900">{value}</p>
    {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
  </div>
);

// ── About this listing (description + AI insights) ────────────────────

/**
 * Combined "what does the source say + what did Claude pull out" panel.
 * Description is collapsible because some scraper-pulled descriptions
 * are 2k+ char walls of HTML; AI summary stays open as the headline
 * digest. Tags + red flags surface as small chip rows.
 */
const AboutListing = ({ property }: { property: Property }) => {
  const [openDesc, setOpenDesc] = useState(false);
  const tags = property.aiTags ?? [];
  const flags = property.redFlags ?? [];
  const summary = property.aiSummary;
  const description = property.description;
  const hasAnything = !!summary || !!description || tags.length > 0 || flags.length > 0;
  if (!hasAnything) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-base font-semibold text-gray-900">About this listing</h3>

      {summary && (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
            Claude&rsquo;s read
          </p>
          <p className="text-sm text-gray-700 italic leading-relaxed">
            &ldquo;{summary}&rdquo;
          </p>
        </div>
      )}

      {(tags.length > 0 || flags.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">
              Strengths ({tags.length})
            </p>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    title={AI_TAG_DESCRIPTIONS[t]}
                    className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 font-medium cursor-help"
                  >
                    {AI_TAG_LABELS[t]}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No positive tags extracted.</p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-amber-700 font-semibold mb-1">
              Red flags ({flags.length})
            </p>
            {flags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {flags.map((f) => {
                  const sev = RED_FLAG_SEVERITY[f] ?? 3;
                  return (
                    <span
                      key={f}
                      title={`${RED_FLAG_DESCRIPTIONS[f] ?? ''} (severity ${sev}/5)`}
                      className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700 font-medium cursor-help"
                    >
                      {RED_FLAG_LABELS[f]}
                      <span className="ml-1 text-amber-500">{'•'.repeat(sev)}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400">None raised.</p>
            )}
          </div>
        </div>
      )}

      {description && (
        <div>
          <button
            type="button"
            onClick={() => setOpenDesc((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-0.5"
          >
            {openDesc ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            Source description
          </button>
          {openDesc && (
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-line leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

// ── Research links (consolidated) ─────────────────────────────────────

/**
 * Single panel collecting every outbound link to the public datasets
 * the page's heuristics + records reference. Replaces the scattered
 * "Sources" rows on individual panels with one place to verify the
 * underlying data.
 */
const ResearchLinks = ({ property }: { property: Property }) => {
  const lat = property.location?.lat ?? 0;
  const lng = property.location?.lng ?? 0;
  const state = (property.location?.state ?? '').toUpperCase();
  if (!lat || !lng) return null;

  const links: Array<{ href: string; label: string; group: string }> = [
    // Soil / climate / water
    { group: 'Land', href: `https://websoilsurvey.sc.egov.usda.gov/App/WebSoilSurvey.aspx?lat=${lat}&lon=${lng}`, label: 'USDA Web Soil Survey' },
    { group: 'Land', href: 'https://planthardiness.ars.usda.gov/', label: 'USDA Hardiness Zone Map' },
    { group: 'Land', href: `https://msc.fema.gov/portal/search?AddressQuery=${lat},${lng}`, label: 'FEMA Flood Map' },
    { group: 'Land', href: `https://firststreet.org/`, label: 'First Street climate risk' },
    // Energy
    { group: 'Energy', href: `https://pvwatts.nrel.gov/pvwatts.php?lat=${lat}&lon=${lng}`, label: 'NREL PVWatts' },
    { group: 'Energy', href: `https://programs.dsireusa.org/system/program?state=${state}`, label: `DSIRE — ${state} incentives` },
    // Parcel research
    { group: 'Parcel', href: 'https://traviscad.org/property-search/', label: 'Travis CAD record' },
    { group: 'Parcel', href: 'https://countyclerk.traviscountytx.gov/online-services/', label: 'County clerk deeds' },
    { group: 'Parcel', href: `https://www.google.com/maps/place/${lat},${lng}/@${lat},${lng},18z/data=!3m1!1e3`, label: 'Google satellite view' },
  ];

  const groups = ['Land', 'Energy', 'Parcel'];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900 mb-2">Research & verify</h3>
      <p className="text-xs text-gray-500 mb-3">
        Every score above is a heuristic. These are the public sources we
        calibrated against — click through to verify any specific number.
      </p>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g}>
            <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-0.5">
              {g}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {links
                .filter((l) => l.group === g)
                .map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-0.5"
                  >
                    {l.label}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ── Provenance footer ─────────────────────────────────────────────────

const ListingProvenance = ({ property }: { property: Property }) => {
  const { canSeeSourceLinks } = useAccessTier();
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <DetailItem label="Source" value={formatSourceName(property.source)} />
        <DetailItem label="Found" value={formatDate(property.dateFound)} />
        {property.daysOnMarket != null && (
          <DetailItem label="Days on market" value={`${property.daysOnMarket}`} />
        )}
        {property.validatedAt && (
          <DetailItem label="Last verified" value={formatDate(property.validatedAt)} />
        )}
        {property.location.lat !== 0 && (
          <DetailItem
            label="Lat / lng"
            value={`${property.location.lat.toFixed(4)}, ${property.location.lng.toFixed(4)}`}
          />
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-[11px] text-gray-500 mb-1">Original listing URL</p>
        {canSeeSourceLinks ? (
          <a
            href={safeUrl(property.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-sm break-all"
          >
            {property.url}
          </a>
        ) : (
          <p className="text-xs text-gray-500 italic">
            Sign in to see the source listing URL.
          </p>
        )}
      </div>
    </section>
  );
};

// ── Homestead community (smaller, supporting role) ────────────────────

const HomesteadCommunity = () => (
  <section className="rounded-xl border border-gray-200 bg-white p-4">
    <header className="mb-2">
      <h3 className="text-base font-semibold text-gray-900">Homestead community</h3>
      <p className="text-xs text-gray-500 mt-0.5">
        Like-minded support within reach (preview data — Phase 3 enrichment).
      </p>
    </header>
    <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
      <CommunityRow label="Feed store / co-op" detail="Tractor Supply · 12 min" />
      <CommunityRow label="Farmers' market" detail="Wimberley Square · Sat" />
      <CommunityRow label="Extension office" detail="Travis Co AgriLife · 22 min" />
      <CommunityRow label="Livestock auction" detail="Lockhart · 38 min" />
      <CommunityRow label="Hardware / TS" detail="Atwoods Dripping Springs · 9 min" />
      <CommunityRow label="Intentional community" detail="Pecan Springs Cohousing · 12 mi" />
      <CommunityRow label="Hospital (emergency)" detail="St David's North · 18 min" />
      <CommunityRow label="Internet" detail="Starlink ✓ · AT&T fiber ✓" />
    </div>
  </section>
);

const CommunityRow = ({ label, detail }: { label: string; detail: string }) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="text-xs font-medium text-gray-900 truncate">{detail}</span>
  </div>
);

// ── County records ────────────────────────────────────────────────────

const CountyRecords = ({ cad }: { cad: ReturnType<typeof useCadRecord> }) => {
  if (!cad) {
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-semibold text-gray-900 mb-1">County records</h3>
        <p className="text-xs text-gray-500">No CAD record matched.</p>
      </section>
    );
  }
  const yrs = cad.lastDeedDate
    ? (Date.now() - new Date(cad.lastDeedDate).getTime()) /
      (365.25 * 24 * 3600 * 1000)
    : null;
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <header className="flex items-baseline justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900">County records</h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">
          Travis CAD {cad.valYear ?? ''}
        </span>
      </header>
      <DetailGrid>
        <DetailItem label="Parcel ID" value={cad.geoId} />
        <DetailItem label="Owner" value={cad.owner ?? '—'} />
        <DetailItem
          label="Last deed"
          value={cad.lastDeedDate ?? '—'}
          hint={yrs ? `${yrs.toFixed(0)} yrs ago` : undefined}
        />
        <DetailItem label="CAD acreage" value={`${cad.acreage?.toFixed(2) ?? '—'} ac`} />
        <DetailItem label="Appraised" value={formatPrice(cad.appraisedValue ?? 0)} />
        <DetailItem label="Assessed" value={formatPrice(cad.assessedValue ?? 0)} />
      </DetailGrid>
      <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-3 text-xs">
        <a href="https://traviscad.org/property-search/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          Travis CAD record →
        </a>
        <a href="https://countyclerk.traviscountytx.gov/online-services/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          County clerk deeds →
        </a>
        <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          Satellite view →
        </a>
      </div>
    </section>
  );
};

// ── Financial lens (collapsed by default) ─────────────────────────────

const FinancialLens = ({
  property,
  open,
  onToggle,
}: {
  property: Property;
  open: boolean;
  onToggle: () => void;
}) => (
  <section className="rounded-xl border border-gray-200 bg-white">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between p-4 text-left"
    >
      <div>
        <h3 className="text-base font-semibold text-gray-900">Financial lens</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Buyer-side scores — is this deal-priced fairly?
        </p>
      </div>
      {open ? (
        <ChevronUp className="w-4 h-4 text-gray-500" />
      ) : (
        <ChevronDown className="w-4 h-4 text-gray-500" />
      )}
    </button>
    {open && (
      <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
        <SubScoreRow label="Deal Score" score={property.dealScore ?? 0} />
        <SubScoreRow label="Investment Score" score={property.investmentScore ?? 0} />
        <SubScoreRow label="Homestead Fit (legacy)" score={property.homesteadFitScore ?? 0} />
      </div>
    )}
  </section>
);

const SubScoreRow = ({ label, score }: { label: string; score: number }) => {
  const klass = tierClasses[tier(score)];
  return (
    <div className="flex items-center gap-3 pt-3">
      <Ring score={score} size={36} strokeWidth={4}>
        <span className="text-[11px] font-bold">{Math.round(score)}</span>
      </Ring>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full ${klass.bar}`}
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        </div>
      </div>
    </div>
  );
};

// ── Action bar ────────────────────────────────────────────────────────

const ActionBar = ({ property }: { property: Property }) => {
  const { user, loginWithGoogle } = useAuth();
  const { isSaved, toggle: toggleSaved } = useSavedListings();
  const { isHidden, toggle: toggleHidden } = useHiddenListings();
  const saved = isSaved(property.id);
  const hidden = isHidden(property.id);

  const onSave = async () => {
    if (!user) return void loginWithGoogle();
    try {
      await toggleSaved(property.id);
    } catch {
      // Free-tier limit etc — fail silently for the preview.
    }
  };
  const onHide = async () => {
    if (!user) return void loginWithGoogle();
    await toggleHidden(property.id);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 p-3 shadow-lg sm:max-w-3xl sm:mx-auto sm:rounded-t-xl sm:border sm:border-b-0">
      <p className="text-[11px] text-gray-500 mb-2 px-1">
        Listing live 30 days · 5 similar parcels in this market sold within 60
        days last quarter.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          title={user ? (saved ? 'Saved — click to remove' : 'Save listing') : 'Sign in to save'}
          className={`flex-1 rounded-md border text-sm font-medium py-2 transition-colors ${
            saved
              ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {saved ? '★ Saved' : '☆ Save'}
        </button>
        {user && (
          <button
            onClick={onHide}
            title={hidden ? 'Hidden — click to restore' : 'Not interested'}
            className={`flex-1 rounded-md border text-sm font-medium py-2 transition-colors ${
              hidden
                ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {hidden ? '🚫 Hidden' : '⊘ Hide'}
          </button>
        )}
        {user && (
          <div className="flex-1">
            <AddToProjectButton itemType="listing" itemId={property.id} />
          </div>
        )}
        {/* Primary action — opens the original source. For tax-sale
            rows we point at the county sale list (the actual auction
            page); for everything else, the listing's source URL.
            We aren't a brokerage so the CTA is "go look" not
            "contact seller". */}
        {(() => {
          const isTaxSale = property.status === 'tax_sale' && property.taxSale;
          const target = isTaxSale && property.taxSale?.listUrl
            ? property.taxSale.listUrl
            : property.url;
          const label = isTaxSale ? 'View Auction' : 'View Listing';
          return (
            <a
              href={safeUrl(target)}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex-1 text-center rounded-md text-white text-sm font-semibold py-2 shadow-sm ${
                isTaxSale
                  ? 'bg-orange-600 hover:bg-orange-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {label}
            </a>
          );
        })()}
      </div>
    </div>
  );
};
