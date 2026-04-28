import { STRIPE_PAYMENT_LINKS } from '../lib/billing';
import { useAuth } from '../hooks/useAuth';

/**
 * Append the signed-in user's Supabase UUID to a Stripe Payment
 * Link as `client_reference_id` so the webhook can map back from
 * Stripe customer → app user when the subscription event arrives.
 *
 * The Edge Function reads this off the Checkout Session and stamps
 * it onto the Stripe Customer's metadata; subsequent renewal /
 * cancel events look the user up via that metadata.
 *
 * No-ops when the user isn't signed in (the `<a>` shouldn't be
 * clickable in that state anyway — the upgrade flow is auth-gated
 * upstream).
 */
const withClientReferenceId = (href: string, userId: string | null): string => {
  if (!href || !userId) return href || '#';
  // Payment Links accept `client_reference_id` as a URL query param.
  // We can't be sure the operator's URL doesn't already have a `?`
  // (some links carry `prefilled_promo_code` etc.) so detect.
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}client_reference_id=${encodeURIComponent(userId)}`;
};

interface UpgradeModalProps {
  /** What feature triggered the upgrade prompt — affects copy. */
  reason?:
    | 'saved_listings_limit'
    | 'projects_limit'
    | 'recommended_sort'
    | 'ai_enrichment'
    | 'generic';
  open: boolean;
  onClose: () => void;
  /** Render inline in-page (no overlay) instead of a centered modal.
   * Used by the /upgrade route so upgrade flow lives at a real URL. */
  asPage?: boolean;
}

const REASON_COPY: Record<
  NonNullable<UpgradeModalProps['reason']>,
  { headline: string; body: string }
> = {
  saved_listings_limit: {
    headline: "You've hit the 5-listing free limit",
    body: 'Upgrade to save unlimited listings and keep your full shortlist.',
  },
  projects_limit: {
    headline: 'Free plan: 1 project',
    body: 'Upgrade to organize unlimited projects with files, notes, and per-project AI context.',
  },
  recommended_sort: {
    headline: 'Personalized ranking is a paid feature',
    body: 'Upgrade to unlock the "Recommended for you" sort, which learns from your saves and reactions.',
  },
  ai_enrichment: {
    headline: 'AI enrichment is a paid feature',
    body: 'Upgrade to see AI fit scores, red flags, and one-line summaries on every listing.',
  },
  generic: {
    headline: 'Upgrade Homestead Finder',
    body: 'Unlock unlimited saves, projects, and AI-powered ranking.',
  },
};

/**
 * Pricing modal. Shows monthly + annual side by side; clicking a
 * tier opens the Stripe-hosted Payment Link in the same tab. After
 * successful payment Stripe redirects back with `?checkout=success`
 * which the SubscriptionProvider picks up to refresh state.
 *
 * No payment UI inside the app — Stripe Checkout / Payment Links
 * handle PCI scope. We only render the pricing.
 */
export const UpgradeModal = ({
  reason = 'generic',
  open,
  onClose,
  asPage = false,
}: UpgradeModalProps) => {
  // Hooks must run before any early-return so React's hook-order
  // invariant holds across renders where `open` flips.
  const { user } = useAuth();
  if (!open) return null;
  const copy = REASON_COPY[reason];
  const userId = user?.id ?? null;
  const monthlyHref = withClientReferenceId(STRIPE_PAYMENT_LINKS.monthly, userId);
  const annualHref = withClientReferenceId(STRIPE_PAYMENT_LINKS.annual, userId);
  const linksConfigured = Boolean(STRIPE_PAYMENT_LINKS.monthly && STRIPE_PAYMENT_LINKS.annual);

  const wrapper = asPage
    ? 'p-6'
    : 'fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4';

  return (
    <div className={wrapper}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-auto">
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900">{copy.headline}</h2>
          <p className="text-sm text-gray-600 mt-1.5">{copy.body}</p>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <a
              href={monthlyHref || '#'}
              onClick={(e) => {
                if (!linksConfigured) e.preventDefault();
              }}
              className={`border rounded-lg p-4 text-center transition-colors ${
                linksConfigured
                  ? 'border-gray-200 hover:border-green-400 cursor-pointer'
                  : 'border-gray-100 bg-gray-50 cursor-not-allowed'
              }`}
            >
              <p className="text-xs text-gray-500 mb-1">Monthly</p>
              <p className="text-2xl font-bold text-gray-900">
                $19<span className="text-sm font-medium text-gray-500">/mo</span>
              </p>
              <p className="text-[11px] text-gray-400 mt-1">Cancel anytime</p>
            </a>
            <a
              href={annualHref || '#'}
              onClick={(e) => {
                if (!linksConfigured) e.preventDefault();
              }}
              className={`border-2 rounded-lg p-4 text-center transition-colors ${
                linksConfigured
                  ? 'border-green-400 hover:border-green-500 cursor-pointer bg-green-50/40'
                  : 'border-gray-100 bg-gray-50 cursor-not-allowed'
              }`}
            >
              <p className="text-xs text-green-700 mb-1 font-semibold">
                Annual · save 17%
              </p>
              <p className="text-2xl font-bold text-gray-900">
                $190<span className="text-sm font-medium text-gray-500">/yr</span>
              </p>
              <p className="text-[11px] text-gray-400 mt-1">~$15.83/mo</p>
            </a>
          </div>

          <div className="mt-4 text-xs text-gray-500 space-y-1">
            <p>
              <strong>Includes:</strong> unlimited saves and projects, AI
              ranking + Recommended sort, image upload, file context for
              in-project AI queries, full search history.
            </p>
            <p>
              7-day full-feature trial · billed via Stripe · cancel from
              your account menu any time.
            </p>
          </div>

          {!linksConfigured && (
            <p className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠️ Stripe Payment Links not configured. Operator: set{' '}
              <code>VITE_STRIPE_LINK_MONTHLY</code> and{' '}
              <code>VITE_STRIPE_LINK_ANNUAL</code> in <code>.env.local</code>.
            </p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
};
