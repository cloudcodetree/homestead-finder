import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getListingById } from '@/lib/listings';
import { FEATURE_LABELS } from '@/types/property';
import {
  formatPrice,
  formatAcreage,
  formatPricePerAcre,
  formatDate,
  formatSourceName,
} from '@/lib/formatters';
import { getDealScoreColor, getDealScoreLabel } from '@/lib/scoring';
import { ValidationBadge } from '@/components/ValidationBadge';
import { UrlCopyButton } from '@/components/UrlCopyButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Extract the sale type (Tax Lien / Tax Deed / Foreclosure) from the description.
 * Used in the SEO title to front-load the most searchable keywords.
 */
const getSaleType = (description?: string): string => {
  if (!description) return '';
  const match = description.match(/Type:\s*([^.]+)/);
  if (!match) return '';
  const type = match[1].trim().toLowerCase();
  if (type.includes('lien')) return 'Tax Lien';
  if (type.includes('deed')) return 'Tax Deed';
  if (type.includes('foreclosure')) return 'Foreclosure';
  return '';
};

/**
 * Truncate to a max length, adding ellipsis if needed.
 * Used to keep meta descriptions within Google's 155-char limit.
 */
const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = getListingById(decodeURIComponent(id));
  if (!listing) {
    return { title: 'Listing not found' };
  }

  const { location, acreage, price, dealScore } = listing;
  const saleType = getSaleType(listing.description);

  // Title: front-load acreage + county + state + sale type + price.
  // Google truncates around 60 chars; leave room for the "| Homestead Finder"
  // template suffix from the root layout (+20 chars).
  //
  // Examples:
  //   "40 Acres — Autauga County, AL — Tax Lien $286"
  //   "80 Acres — Madison County, MT — $65,000"
  //   "Tax Lien — Shelby County, AL — $1,543"
  let title: string;
  if (acreage > 0) {
    const parts = [
      `${Math.round(acreage)} Acres`,
      `${location.county} County, ${location.state}`,
    ];
    if (saleType) parts.push(`${saleType} ${formatPrice(price)}`);
    else parts.push(formatPrice(price));
    title = parts.join(' — ');
  } else {
    // Tax sales often have no acreage — lead with sale type + location + face value.
    const parts = [
      saleType || 'Land Listing',
      `${location.county} County, ${location.state}`,
      formatPrice(price),
    ];
    title = parts.join(' — ');
  }

  // Description: 140-160 chars. Summarize the deal quality and invite the click.
  const scoreLabel = getDealScoreLabel(dealScore);
  const sourceName = formatSourceName(listing.source);
  const acreagePart = acreage > 0 ? `${formatAcreage(acreage)} ` : '';
  const pricePart =
    acreage > 0
      ? `${formatPrice(price)} (${formatPricePerAcre(listing.pricePerAcre)})`
      : `Face value ${formatPrice(price)}`;

  const description = truncate(
    `${acreagePart}in ${location.county} County, ${location.state}. ${pricePart}. ` +
      `Deal score: ${dealScore}/100 (${scoreLabel}). Source: ${sourceName}.`,
    155,
  );

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
    },
  };
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const listing = getListingById(decodeURIComponent(id));
  if (!listing) notFound();

  const scoreColor = getDealScoreColor(listing.dealScore);
  const status = listing.status ?? 'unverified';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/deals"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Back to all deals
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Header with title, validation badge, and score */}
        <div className="flex items-start gap-3 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">
              {listing.title}
            </h1>
            <p className="text-gray-500 mt-1">
              {listing.location.county} County, {listing.location.state} &middot;{' '}
              {formatSourceName(listing.source)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ValidationBadge status={listing.status} size="md" />
            <div
              className={`rounded-full px-4 py-2 text-lg font-bold ${scoreColor}`}
            >
              {listing.dealScore}
            </div>
          </div>
        </div>

        {/* Key stats — adapts to whether acreage is known */}
        <div
          className={`grid gap-4 mb-6 ${
            listing.acreage > 0 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'
          }`}
        >
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(listing.price)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {listing.acreage > 0 ? 'Asking Price' : 'Face Value'}
            </p>
          </div>
          {listing.acreage > 0 && (
            <>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {formatAcreage(listing.acreage)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Total Acreage</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {formatPricePerAcre(listing.pricePerAcre)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Price / Acre</p>
              </div>
            </>
          )}
        </div>

        {listing.description && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Description
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {listing.description}
            </p>
          </div>
        )}

        {listing.features.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Features
            </h2>
            <div className="flex flex-wrap gap-2">
              {listing.features.map((feature) => (
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

        {/* Metadata grid — skip lat/lng if unset */}
        <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <p className="text-gray-500 text-xs">Source</p>
            <p className="text-gray-800 font-medium">
              {formatSourceName(listing.source)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Found</p>
            <p className="text-gray-800 font-medium">
              {formatDate(listing.dateFound)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Score</p>
            <p className="text-gray-800 font-medium">
              {listing.dealScore} — {getDealScoreLabel(listing.dealScore)}
            </p>
          </div>
          {(listing.location.lat !== 0 || listing.location.lng !== 0) && (
            <div>
              <p className="text-gray-500 text-xs">Location</p>
              <p className="text-gray-800 font-medium">
                {listing.location.lat.toFixed(4)},{' '}
                {listing.location.lng.toFixed(4)}
              </p>
            </div>
          )}
        </div>

        {/* Listing URL with copy button (client component leaf) */}
        <div className="border-t border-gray-100 pt-4 mb-6">
          <p className="text-gray-500 text-xs mb-1">Listing URL</p>
          <div className="flex items-center gap-2 min-w-0">
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              title={listing.url}
              className="text-blue-600 hover:underline text-sm truncate min-w-0 flex-1"
            >
              {listing.url}
            </a>
            <UrlCopyButton url={listing.url} />
          </div>
        </div>

        {/* Status-aware CTA */}
        <div>
          {status === 'unverified' && (
            <p className="text-xs text-yellow-700 text-center mb-2">
              ⚠ Sample listing — link may not work
            </p>
          )}
          {status === 'expired' && (
            <p className="text-xs text-red-600 text-center mb-2">
              ✗ This listing has expired or is no longer available
            </p>
          )}
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full text-center font-semibold py-3 rounded-lg transition-colors ${
              status === 'expired'
                ? 'bg-gray-200 text-gray-500'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            View Full Listing →
          </a>
        </div>
      </div>
    </div>
  );
}
