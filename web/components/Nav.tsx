import Link from 'next/link';

export const Nav = () => {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4 flex-shrink-0">
      <Link href="/" className="flex items-center gap-2">
        <span className="text-xl">🌿</span>
        <h1 className="font-bold text-gray-900 text-lg">Homestead Finder</h1>
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/deals"
          className="text-gray-600 hover:text-gray-900 font-medium"
        >
          Browse Deals
        </Link>
        <Link
          href="/states/MT"
          className="text-gray-600 hover:text-gray-900 font-medium"
        >
          By State
        </Link>
      </nav>
    </header>
  );
};
