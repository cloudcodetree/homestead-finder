import { Bell, Bookmark, Megaphone, Newspaper, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  useMarketNews,
  useSiteUpdates,
  type NewsItem,
} from '../hooks/useMarketNews';
import { useSavedListings } from '../hooks/useSavedListings';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { photoUrl } from '../lib/genericPhotos';

/**
 * "News" surface above and below the Top Picks carousel on /home.
 * Composed of independent strips so each one can self-gate on
 * whether it has anything to say. Layout (top → bottom):
 *
 *   1. WelcomeStrip    — generic greeting → personalized after the
 *                        user has saved at least one listing.
 *   2. AlertsStrip     — saved-search summaries (renders only when
 *                        the user has at least one saved search).
 *   3. (Top Picks carousel slots in here, rendered by HomeFeed.)
 *   4. MarketNewsStrip — operator-curated `data/market_news.json`,
 *                        rendered as a 2-3 col newspaper grid with
 *                        generic hero photos so it reads like a feed
 *                        rather than a status page.
 *   5. SiteUpdatesStrip — operator-curated `data/site_updates.json`,
 *                        changelog-style entries.
 *
 * Strips render in their own slots so HomeFeed can interleave the
 * picks carousel between AlertsStrip and MarketNewsStrip without
 * this component knowing about it.
 */

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Heading shared across the home-page strips (and matched by
 * TopPicksCarousel) so all four sections read at the same visual
 * level — section icon, bold title, optional tagline. Without this
 * the news sections were a quieter "uppercase tracking-wide" caption
 * style and felt secondary to Top Picks.
 */
const SectionHeader = ({
  icon: Icon,
  title,
  tagline,
}: {
  icon: typeof Newspaper;
  title: string;
  tagline?: React.ReactNode;
}) => (
  <div className="mb-3">
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-gray-700" aria-hidden="true" />
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
    </div>
    {tagline && (
      <p className="text-xs text-gray-500 mt-0.5 ml-6">{tagline}</p>
    )}
  </div>
);

export const WelcomeStrip = () => {
  const { user } = useAuth();
  const { savedIds } = useSavedListings();
  const savedCount = savedIds.size;
  const firstName =
    user?.user_metadata?.full_name?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    null;

  // Three states:
  //   anonymous   → cold-start "welcome to homestead finder"
  //   signed-in,
  //     no signal → onboarding nudge
  //     w/ signal → "Welcome back, X — you've saved N listings"
  let body: React.ReactNode;
  if (!user) {
    body = (
      <>
        <p className="text-sm text-gray-700">
          Welcome to Homestead Finder. We aggregate every active
          rural-land listing in MO + AR and score each one on value,
          land quality, and risk so you can shop the way you'd
          research a stock.
        </p>
        <Link
          to="/landing"
          className="inline-block mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          What we do →
        </Link>
      </>
    );
  } else if (savedCount === 0) {
    body = (
      <p className="text-sm text-gray-700">
        Welcome{firstName ? `, ${firstName}` : ''}. Save a listing or
        two and the For-You feed gets sharper — we use what you save
        and how you rate listings to surface ones you haven't seen.
      </p>
    );
  } else {
    body = (
      <p className="text-sm text-gray-700">
        Welcome back{firstName ? `, ${firstName}` : ''}. You've saved{' '}
        <span className="font-semibold">{savedCount}</span>{' '}
        {savedCount === 1 ? 'listing' : 'listings'} — the picks below
        are tuned to that signal.
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
      <div className="flex items-start gap-3">
        <Sparkles
          className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">{body}</div>
      </div>
    </section>
  );
};

export const AlertsStrip = () => {
  const { searches, loading } = useSavedSearches();
  if (loading || searches.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <SectionHeader
        icon={Bell}
        title="Your saved searches"
        tagline={`${searches.length} saved ${searches.length === 1 ? 'search' : 'searches'} watching the corpus on your behalf.`}
      />
      <ul className="space-y-1.5">
        {searches.slice(0, 3).map((s) => (
          <li key={s.id}>
            <Link
              to={`/saved-searches`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-900 truncate">
                {s.name}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400">
                {s.notifyCadence}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {searches.length > 3 && (
        <Link
          to="/saved-searches"
          className="inline-block mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-900"
        >
          View all {searches.length} saved searches →
        </Link>
      )}
    </section>
  );
};

/**
 * Newspaper-style market-news card. Hero photo on top (generic stock
 * keyed by `imageKeyword`), date pill, title, lede paragraph. Sized
 * to fit a 2-col grid on tablet, 3-col on desktop.
 */
const NewspaperCard = ({ item }: { item: NewsItem }) => {
  const photo = photoUrl(item.imageKeyword);
  const accent =
    item.tone === 'highlight'
      ? 'border-emerald-300 ring-1 ring-emerald-100'
      : 'border-gray-200';
  return (
    <article
      className={`rounded-xl border ${accent} bg-white overflow-hidden flex flex-col`}
    >
      {photo ? (
        <div className="relative aspect-[16/9] bg-gray-100 overflow-hidden">
          <img
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
          <span className="absolute top-2 left-2 inline-flex items-center text-[10px] font-bold uppercase tracking-wide text-white bg-black/55 backdrop-blur-sm rounded px-1.5 py-0.5">
            {formatDate(item.publishedAt)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {formatDate(item.publishedAt)}
          </span>
        </div>
      )}
      <div className="p-3 flex flex-col flex-1">
        <h4 className="text-sm font-semibold text-gray-900 leading-snug mb-1.5">
          {item.title}
        </h4>
        <p className="text-xs text-gray-600 leading-relaxed line-clamp-5">
          {item.body}
        </p>
      </div>
    </article>
  );
};

export const MarketNewsStrip = () => {
  const items = useMarketNews();
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-amber-50/30 p-4">
      <SectionHeader
        icon={Newspaper}
        title="Market news"
        tagline="Editorial notes on the corpus and what's moving in the regions we cover."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {items.slice(0, 4).map((item) => (
          <NewspaperCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
};

/** Compact card for the changelog-style site-updates strip — no hero
 * photo (these are app updates, not editorial content). */
const UpdateCard = ({ item }: { item: NewsItem }) => (
  <article className="rounded-lg border border-gray-200 bg-white p-3 border-l-4 border-l-gray-200">
    <header className="flex items-baseline justify-between gap-2 mb-1">
      <h4 className="text-sm font-semibold text-gray-900">{item.title}</h4>
      <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
        {formatDate(item.publishedAt)}
      </span>
    </header>
    <p className="text-xs text-gray-600 leading-relaxed">{item.body}</p>
  </article>
);

export const SiteUpdatesStrip = () => {
  const items = useSiteUpdates();
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-sky-50/40 p-4">
      <SectionHeader
        icon={Megaphone}
        title="What's new in Homestead Finder"
        tagline="Recent app updates and shipped features."
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {items.slice(0, 4).map((item) => (
          <UpdateCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
};
