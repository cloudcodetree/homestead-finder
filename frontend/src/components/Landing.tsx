import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { UpgradeModal } from './UpgradeModal';

/** Stash key for the post-OAuth redirect target. The Supabase redirect
 * URL is configured globally, so we can't tunnel `next` through the
 * OAuth roundtrip — we save it here and pop it on signed-in landing. */
const NEXT_AFTER_AUTH_KEY = 'hf:auth-next';

/**
 * Public landing page at `/landing`. Doubles as the marketing front
 * door for the /r/homestead launch. Existing users land at `/`
 * (Dashboard); new visitors hit this.
 *
 * Single page, no scroll-jack. Three sections only:
 *   1. Hero — what the app is, who it's for, one CTA
 *   2. The wedge — "every other land site is a seller-funded listing
 *      dump; we're a research desk for buyers"
 *   3. Features grid — concrete bullets with screenshots later
 *   4. Pricing — clear 2-tier pricing, free → paid
 *   5. CTA + footer
 *
 * No fluff sections. No team page. No testimonials yet (we'll have
 * none until users exist). Honest > polished at this stage.
 */
export const Landing = () => {
  const { user, loginWithGoogle } = useAuth();
  const [showPricing, setShowPricing] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `?next=` is set by AppShell's auth gate when an anonymous user
  // tries to deep-link into a protected route. Show a "sign up to
  // access" banner and stash the path so OAuth redirects them back.
  const nextPath = searchParams.get('next');

  const startSignup = () => {
    if (nextPath) {
      try {
        sessionStorage.setItem(NEXT_AFTER_AUTH_KEY, nextPath);
      } catch {
        // ignore — non-critical, we'll just send them to /home
      }
    }
    void loginWithGoogle();
  };

  // Auto-bounce signed-in visitors into the shell. Honors a
  // previously-stashed `next` so a deep-link click that triggered
  // the auth flow lands the user where they were aiming. Falls back
  // to /home for the cold-start case.
  useEffect(() => {
    if (!user) return;
    let target = '/home';
    try {
      const stashed = sessionStorage.getItem(NEXT_AFTER_AUTH_KEY);
      if (stashed && stashed.startsWith('/') && !stashed.startsWith('//')) {
        target = stashed;
      }
      sessionStorage.removeItem(NEXT_AFTER_AUTH_KEY);
    } catch {
      // ignore — fall through to /home
    }
    navigate(target, { replace: true });
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-white">
      {/* Top nav */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌿</span>
            <span className="font-bold text-gray-900">Homestead Finder</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPricing(true)}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Pricing
            </button>
            {user ? (
              <Link
                to="/"
                className="text-sm font-medium text-green-700 hover:text-green-900"
              >
                Open dashboard →
              </Link>
            ) : (
              <>
                <button
                  onClick={startSignup}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Sign in
                </button>
                <Link
                  to="/home"
                  className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-3.5 py-1.5 rounded-lg shadow-sm"
                >
                  Try it out →
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center">
        <p className="text-sm font-semibold text-green-700 tracking-wide uppercase mb-3">
          Buyer-side intelligence for homestead land
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight">
          Research rural land the way you&apos;d{' '}
          <span className="text-green-700">research a stock</span>.
        </h1>
        <p className="text-lg text-gray-600 mt-4 max-w-2xl mx-auto">
          Every other land site is a seller-funded listing dump. We aggregate
          listings from sources the big aggregators miss, score them as
          homesteading deals, and rank them based on what you actually want
          to buy.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {user ? (
            <Link
              to="/"
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg"
            >
              Open dashboard →
            </Link>
          ) : (
            <button
              onClick={() => void loginWithGoogle()}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg"
            >
              Start free — no credit card
            </button>
          )}
          <button
            onClick={() => setShowPricing(true)}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium px-6 py-3 rounded-lg"
          >
            See pricing
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Free for 5 saved listings. $19/mo unlocks unlimited + projects + AI
          ranking.
        </p>
      </section>

      {/* Wedge / why-different */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-14">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Every other land site is built for sellers.
          </h2>
          <p className="text-gray-700 leading-relaxed">
            LandWatch, Land.com, LandHub — all free to buyers because their
            revenue comes from listing fees and broker advertising. The site
            shows you a wall of listings sorted by who paid for placement,
            not by what fits a homestead. Every listing looks equal. There&apos;s
            no deal score, no personalization, no AI ranking. The buyer is
            the product.
          </p>
          <p className="text-gray-700 leading-relaxed mt-3">
            Homestead Finder is the research desk for the other side of the
            transaction. We aggregate the same inventory plus FSBO and tax-sale
            sources the big sites skip, then layer the analysis on top:
            structures-aware $/acre, total cost-to-homestead, proximity to
            services, AI-derived homestead-fit score, personal ranking that
            learns from your saves and ratings. You pay $19/mo. We work for
            you.
          </p>
        </div>
      </section>

      {/* Features grid */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
          What you get
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-gray-100 rounded-lg p-5">
              <div className="text-2xl mb-2">{f.emoji}</div>
              <h3 className="font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            Pricing
          </h2>
          <p className="text-gray-600 text-center mb-8">
            Start free. Upgrade when you&apos;re shopping seriously.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PRICING_TIERS.map((t) => (
              <div
                key={t.label}
                className={`rounded-xl border bg-white p-6 ${
                  t.featured
                    ? 'border-green-400 shadow-lg ring-2 ring-green-100'
                    : 'border-gray-200'
                }`}
              >
                {t.featured && (
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">
                    Best value
                  </p>
                )}
                <h3 className="text-lg font-bold text-gray-900">{t.label}</h3>
                <p className="mt-2">
                  <span className="text-3xl font-bold text-gray-900">{t.price}</span>
                  <span className="text-sm text-gray-500"> {t.unit}</span>
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  {t.includes.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="text-green-600 mt-0.5">✓</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    if (t.cta === 'free') {
                      if (user) window.location.href = '/';
                      else void loginWithGoogle();
                    } else {
                      setShowPricing(true);
                    }
                  }}
                  className={`mt-6 w-full py-2.5 rounded-lg font-medium text-sm ${
                    t.featured
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'border border-gray-300 hover:border-gray-400 text-gray-700'
                  }`}
                >
                  {t.ctaLabel}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Stop scrolling LandWatch.
        </h2>
        <p className="text-gray-600 mb-6">
          Every active rural-land listing in the greater Austin area
          (Travis, Williamson, Hays, Bastrop, Caldwell) is already in
          the corpus, scored, and waiting for you to react to. The
          model gets sharper every save, every rating, every hide.
        </p>
        {user ? (
          <Link
            to="/"
            className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg"
          >
            Open dashboard →
          </Link>
        ) : (
          <button
            onClick={() => void loginWithGoogle()}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg"
          >
            Start free
          </button>
        )}
      </section>

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-4xl mx-auto px-6 text-center text-xs text-gray-400">
          Homestead Finder · Built for the next homesteading wave ·
          Greater Austin first, expanding
        </div>
      </footer>

      <UpgradeModal
        open={showPricing}
        onClose={() => setShowPricing(false)}
        reason="generic"
      />
    </div>
  );
};

const FEATURES = [
  {
    emoji: '🏠',
    title: 'Structures-aware pricing',
    body: 'A cabin on 40 acres for $250k isn\'t worse than 40 bare acres for $200k. We compute residual land $/ac after subtracting estimated structure value, so improved listings can compete.',
  },
  {
    emoji: '🎯',
    title: 'Personal ranking',
    body: 'Save what you like, rate what you don\'t. The model learns your taste — Recommended for You sort surfaces listings you\'d actually want, not what paid for placement.',
  },
  {
    emoji: '📁',
    title: 'Projects pipeline',
    body: 'Organize your hunt by status: scouting, shortlisted, offered, closed. Pin listings, save notes, drop in inspection PDFs as AI context. Your buyer-side research desk.',
  },
  {
    emoji: '🌲',
    title: 'Sources others miss',
    body: 'LandWatch + Mossy Oak + LandHub + Craigslist FSBO + United Country + county tax sales. Hidden-gem inventory the big aggregators skip.',
  },
  {
    emoji: '🌧',
    title: 'Total cost to homestead',
    body: 'Asking price + estimated build-out cost = the actual number you\'re underwriting. Move-in ready listings flagged so you don\'t have to read every description.',
  },
  {
    emoji: '🤖',
    title: 'AI fit score',
    body: 'Every listing scored 0–100 for homestead suitability based on water, buildability, isolation, and red flags. Saves you reading every description.',
  },
];

const PRICING_TIERS = [
  {
    label: 'Free',
    price: '$0',
    unit: 'forever',
    cta: 'free' as const,
    ctaLabel: 'Start free',
    featured: false,
    includes: [
      'Up to 5 saved listings',
      'Basic filters + deal score',
      'Top Picks feed (read-only)',
      '"Not interested" hide button',
    ],
  },
  {
    label: 'Monthly',
    price: '$19',
    unit: '/ month',
    cta: 'paid' as const,
    ctaLabel: 'Subscribe monthly',
    featured: false,
    includes: [
      'Unlimited saved listings',
      'Unlimited projects + files',
      '"Recommended for you" sort',
      'AI enrichment + fit scores',
      'Saved searches + alerts',
      'Image-driven search',
    ],
  },
  {
    label: 'Annual',
    price: '$190',
    unit: '/ year',
    cta: 'paid' as const,
    ctaLabel: 'Subscribe annual',
    featured: true,
    includes: [
      'Everything in Monthly',
      'Save 17% — ~$15.83/mo',
      '7-day full-feature trial',
      'Cancel anytime',
    ],
  },
];
