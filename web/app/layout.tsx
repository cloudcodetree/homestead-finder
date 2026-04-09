import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Homestead Finder — Tax sales, auctions, and land deals',
    template: '%s | Homestead Finder',
  },
  description:
    'Find affordable rural land deals across 11 states. Tax sales, auctions, and BLM disposals aggregated from hundreds of sources.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
