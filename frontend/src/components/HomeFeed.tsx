import {
  AlertsStrip,
  MarketNewsStrip,
  SiteUpdatesStrip,
  WelcomeStrip,
} from './HomeNews';
import { TopPicksCarousel } from './TopPicksCarousel';

/**
 * `/home` — the user's landing page after sign-in (and the public
 * page anonymous "Try it out" visitors land on).
 *
 * Vertical stack, top → bottom:
 *
 *   1. WelcomeStrip       — generic greeting → personalized once
 *                           the user has saves.
 *   2. AlertsStrip        — saved-search summaries (only renders
 *                           when the user has at least one).
 *   3. TopPicksCarousel   — horizontal-scroll Sonnet-curated picks.
 *                           Slotted high so the most actionable
 *                           content is "above the fold" once the
 *                           welcome / alerts intro is read.
 *   4. MarketNewsStrip    — newspaper-style 2-3 col grid with hero
 *                           photos, operator-curated.
 *   5. SiteUpdatesStrip   — changelog-style site updates.
 *
 * Each strip self-gates so cold-start visitors see a clean page —
 * empty alerts hide; missing curated.json hides the carousel.
 */
export const HomeFeed = () => (
  <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
    <WelcomeStrip />
    <AlertsStrip />
    <TopPicksCarousel />
    <MarketNewsStrip />
    <SiteUpdatesStrip />
  </div>
);
