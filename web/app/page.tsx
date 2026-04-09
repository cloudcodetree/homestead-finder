import Link from 'next/link';
import { loadListings } from '@/lib/listings';

export default function HomePage() {
  const listings = loadListings();
  const totalCount = listings.length;
  const hotDeals = listings.filter((l) => l.dealScore >= 80).length;
  const states = new Set(listings.map((l) => l.location.state)).size;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
          Find affordable rural land before anyone else.
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          We scrape tax sales, government auctions, and surplus land programs
          across 11 states. Every deal scored 0-100, updated daily.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto mb-12">
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-gray-900">{totalCount}</p>
          <p className="text-sm text-gray-500 mt-1">Listings tracked</p>
        </div>
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-green-600">{hotDeals}</p>
          <p className="text-sm text-gray-500 mt-1">Hot deals (80+ score)</p>
        </div>
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-gray-900">{states}</p>
          <p className="text-sm text-gray-500 mt-1">States covered</p>
        </div>
      </div>

      <div className="text-center">
        <Link
          href="/deals"
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
        >
          Browse all deals →
        </Link>
      </div>
    </div>
  );
}
