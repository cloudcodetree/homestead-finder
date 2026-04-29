import { Bell, Bookmark, Megaphone, Newspaper, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMarketNews, useSiteUpdates, type NewsItem } from '../hooks/useMarketNews';
import { useSavedListings } from '../hooks/useSavedListings';
import { useSavedSearches } from '../hooks/useSavedSearches';

/**
 * "News" section above the Top Picks carousel on /home. Composed of
 * four optional strips so each one can self-gate on whether it has
 * anything to say:
 *
 *   1. WelcomeStrip     — generic greeting for cold-start users;
 *                         evolves into a personalized "you've saved
 *                         X / rated Y" line once there's signal.
 *   2. AlertsStrip      — saved-search summaries (only renders when
 *                         the user has at least one saved search).
 *   3. MarketNewsStrip  — operator-curated `data/market_news.json`,
 *                         editorial content covering corpus changes
 *                         and county trends.
 *   4. SiteUpdatesStrip — operator-curated `data/site_updates.json`,
 *                         changelog-style entries for new features.
 *
 * Each strip ships its own header + icon so the user can scan
 * vertically without reading.
 */

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const NewsCard = ({ item }: { item: NewsItem }) => {
  const accent =
    item.tone === 'highlight'
      ? 'border-l-emerald-500'
      : 'border-l-gray-200';
  return (
    <article
      className={`rounded-lg border border-gray-200 bg-white p-3 border-l-4 ${accent}`}
    >
      <header className="flex items-baseline justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold text-gray-900 truncate">
          {item.title}
        </h4>
        <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
          {formatDate(item.publishedAt)}
        </span>
      </header>
      <p className="text-xs text-gray-600 leading-relaxed">{item.body}</p>
    </article>
  );
};

const SectionHeader = ({
  icon: Icon,
  title,
}: {
  icon: typeof Newspaper;
  title: string;
}) => (
  <div className="flex items-center gap-2 mb-2">
    <Icon className="w-4 h-4 text-gray-500" aria-hidden="true" />
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {title}
    </h3>
  </div>
);

const WelcomeStrip = () => {
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

const AlertsStrip = () => {
  const { searches, loading } = useSavedSearches();
  if (loading || searches.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={Bell} title="Your saved searches" />
      <ul className="space-y-1.5">
        {searches.slice(0, 3).map((s) => (
          <li key={s.id}>
            <Link
              to={`/saved-searches`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
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

const MarketNewsStrip = () => {
  const items = useMarketNews();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={Newspaper} title="Market news" />
      <div className="grid gap-2">
        {items.slice(0, 3).map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
};

const SiteUpdatesStrip = () => {
  const items = useSiteUpdates();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={Megaphone} title="What's new in Homestead Finder" />
      <div className="grid gap-2">
        {items.slice(0, 2).map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
};

export const HomeNews = () => (
  <div className="space-y-4">
    <WelcomeStrip />
    <AlertsStrip />
    <MarketNewsStrip />
    <SiteUpdatesStrip />
  </div>
);
