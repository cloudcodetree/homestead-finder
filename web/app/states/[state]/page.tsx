import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getListingsByState, getStateStats } from '@/lib/listings';
import { US_STATES } from '@/types/property';
import { PropertyCard } from '@/components/PropertyCard';
import { formatPrice } from '@/lib/formatters';

interface PageProps {
  params: Promise<{ state: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { state } = await params;
  const upper = state.toUpperCase();
  const stateName = US_STATES[upper];
  if (!stateName) return { title: 'State not found' };

  const stats = getStateStats(upper);
  const count = stats.count;
  return {
    title: `${stateName} land deals — ${count} listings`,
    description: `Browse ${count} land deals in ${stateName}. Tax sales, auctions, and government disposals. Prices from ${formatPrice(stats.minPrice || 0)}.`,
  };
}

export default async function StatePage({ params }: PageProps) {
  const { state } = await params;
  const upper = state.toUpperCase();
  const stateName = US_STATES[upper];
  if (!stateName) notFound();

  const listings = getListingsByState(upper);
  const stats = getStateStats(upper);

  // Sort by score descending, show top 12
  const topListings = [...listings]
    .sort((a, b) => b.dealScore - a.dealScore)
    .slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/deals"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Back to all deals
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {stateName} land deals
        </h1>
        <p className="text-gray-600">
          {stats.count} listings across tax sales, auctions, and government
          programs
        </p>
      </div>

      {stats.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">{stats.count}</p>
            <p className="text-sm text-gray-500">Listings</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-green-600">
              {stats.avgScore}
            </p>
            <p className="text-sm text-gray-500">Avg deal score</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(stats.minPrice)}
            </p>
            <p className="text-sm text-gray-500">Lowest price</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">
              {stats.totalAcreage.toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">Total acres</p>
          </div>
        </div>
      )}

      {topListings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🌾</p>
          <p className="text-gray-600 font-medium">
            No listings yet for {stateName}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Check back soon — new deals are scraped daily.
          </p>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Top {topListings.length} deals
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topListings.map((listing) => (
              <PropertyCard key={listing.id} property={listing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
