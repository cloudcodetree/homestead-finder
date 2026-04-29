import { HomeNews } from './HomeNews';
import { TopPicksCarousel } from './TopPicksCarousel';

/**
 * `/home` — the user's landing page after sign-in (and the public
 * page anonymous "Try it out" visitors land on).
 *
 * Two stacked sections:
 *   1. `<HomeNews />`        — welcome strip + saved-search alerts +
 *                              market news + site updates. Each strip
 *                              self-gates on whether it has anything
 *                              relevant to say so the page collapses
 *                              cleanly for cold-start visitors.
 *   2. `<TopPicksCarousel/>` — horizontal-scroll carousel of the 12
 *                              Sonnet-curated picks, with prev / next
 *                              chevrons. Each card has the headline
 *                              + reason from `data/curated.json`.
 *
 * The previous version of this page was a personalized 12-card grid
 * that blended fitted-model weights, onboarding preferences, and
 * deal score. That logic still lives in the codebase but isn't
 * surfaced here — once we have stronger save-history signal we'll
 * fold it back in as a "Recommended for you" strip inside HomeNews.
 */
export const HomeFeed = () => (
  <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
    <HomeNews />
    <TopPicksCarousel />
  </div>
);
