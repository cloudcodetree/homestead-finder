import type { Metadata } from 'next';
import { loadListings } from '@/lib/listings';
import { DealsClient } from './DealsClient';

export const metadata: Metadata = {
  title: 'Browse all deals',
  description:
    'Browse tax sales, auctions, and government land deals across 11 states. Filter by price, acreage, features, and deal score.',
};

export default function DealsPage() {
  const listings = loadListings();
  return <DealsClient allListings={listings} />;
}
