import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useListingRatings } from '../hooks/useListingRatings';
import { useProperties } from '../hooks/useProperties';
import { useRankingWeights } from '../hooks/useRankingWeights';
import { useSavedListings } from '../hooks/useSavedListings';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { DEFAULT_FILTERS, Property } from '../types/property';
import { scoreWithWeights } from '../utils/personalRank';
import { preferenceMatchScore } from '../utils/preferenceMatch';
import { PropertyCard } from './PropertyCard';

/**
 * Per-user landing page at `/home`. Surfaces a small ranked feed
 * the user is most likely to want, leveraging whatever signal we have
 * about them in priority order:
 *
 *   1. Fitted model (rank_fit weights ≥ MIN_EXAMPLES_FOR_RECOMMENDED)
 *      → score every non-hidden listing, take top 12.
 *   2. Onboarding preferences (no fitted model yet) → blend
 *      preferenceMatchScore with dealScore, top 12.
 *   3. Anonymous / cold-start → top dealScore globally, top 12.
 *
 * Listings already saved or hidden are filtered out so the feed
 * shows fresh inventory the user hasn't reacted to.
 *
 * Not gated by auth — anonymous users see "best deals globally"
 * and a sign-in CTA. Signed-in users with no signal get the same
 * but with a "tell us more" link to onboarding.
 */
const HOME_LIMIT = 12;

export const HomeFeed = () => {
  const { user, loginWithGoogle } = useAuth();
  const { allProperties, loading } = useProperties(DEFAULT_FILTERS);
  const { savedIds } = useSavedListings();
  const { hiddenIds } = useHiddenListings();
  const { ratings } = useListingRatings();
  const { preferences, isComplete: prefsComplete } = useUserPreferences();
  const { weights, hasEnoughData } = useRankingWeights();
  const navigate = useNavigate();
  const [reason, setReason] = useState<string>('');

  const featured = useMemo<Property[]>(() => {
    if (allProperties.length === 0) return [];
    // Filter out things the user has already reacted to, plus hidden.
    // Saves are NOT filtered out — they might want to revisit. We
    // surface fresh-to-them inventory to drive engagement.
    const reactedTo = new Set<string>([...savedIds, ...hiddenIds, ...ratings.keys()]);
    const candidates = allProperties.filter(
      (p) =>
        !reactedTo.has(p.id) &&
        p.status !== 'expired' &&
        p.status !== 'pending',
    );

    // Path 1: fitted model
    if (user && hasEnoughData && weights) {
      setReason('Personalized to your saves and reactions');
      return [...candidates]
        .sort((a, b) => scoreWithWeights(b, weights) - scoreWithWeights(a, weights))
        .slice(0, HOME_LIMIT);
    }

    // Path 2: preference prior
    if (user && prefsComplete) {
      setReason('Based on what you told us about your ideal property');
      return [...candidates]
        .sort((a, b) => {
          const aScore = a.dealScore + preferenceMatchScore(a, preferences);
          const bScore = b.dealScore + preferenceMatchScore(b, preferences);
          return bScore - aScore;
        })
        .slice(0, HOME_LIMIT);
    }

    // Path 3: cold start — best raw deal scores
    setReason('Top deals across the corpus');
    return [...candidates]
      .sort((a, b) => b.dealScore - a.dealScore)
      .slice(0, HOME_LIMIT);
  }, [
    allProperties,
    savedIds,
    hiddenIds,
    ratings,
    user,
    hasEnoughData,
    weights,
    prefsComplete,
    preferences,
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌿</span>
            <h1 className="font-bold text-gray-900 text-lg">Homestead Finder</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Browse all listings →
            </Link>
            {!user && (
              <button
                onClick={() => void loginWithGoogle()}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h2 className="text-2xl font-bold text-gray-900">
            {user ? 'For you' : 'Today\u2019s best deals'}
          </h2>
          <p className="text-sm text-gray-600 mt-1">{reason}</p>
        </div>

        {/* Empty-state nudges — different copy per cold-start path */}
        {user && !prefsComplete && !hasEnoughData && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              Personalize this feed in 30 seconds —{' '}
              <strong>tell us what you&apos;re looking for</strong> and we&apos;ll
              start recommending listings that match.
            </p>
            <button
              onClick={() => navigate('/?prefs=1')}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded whitespace-nowrap"
            >
              Open preferences →
            </button>
          </div>
        )}
        {user && prefsComplete && !hasEnoughData && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
            <p className="text-sm text-blue-900">
              <strong>Save and rate a few listings</strong> and the feed will
              switch to a model trained on your reactions. ~8 saves or
              ratings unlocks the &ldquo;Recommended for you&rdquo; sort.
            </p>
          </div>
        )}

        {loading && featured.length === 0 ? (
          <p className="text-gray-500">Loading…</p>
        ) : featured.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
            <p className="text-gray-700 font-medium mb-1">
              No fresh listings to surface
            </p>
            <p className="text-sm text-gray-500">
              You&apos;ve reacted to everything in the current corpus.
              Tomorrow&apos;s scrape will bring fresh inventory.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {featured.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                onClick={() => navigate(`/p/${p.id}`)}
              />
            ))}
          </div>
        )}

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-block bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-medium px-5 py-2 rounded-lg text-sm"
          >
            See all listings →
          </Link>
          {user && (
            <Link
              to="/swipe"
              className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2 rounded-lg text-sm"
            >
              Swipe mode →
            </Link>
          )}
        </div>
      </main>
    </div>
  );
};
