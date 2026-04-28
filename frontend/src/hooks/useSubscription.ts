import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import {
  FREE_SUBSCRIPTION,
  Subscription,
  fetchSubscription,
  isPaid,
} from '../lib/billing';
import { useAuth } from './useAuth';

/**
 * Subscription state context. Loads once per auth change. Refreshes
 * on demand (e.g. after a user returns from Stripe Checkout). Never
 * polls — Stripe webhooks update Supabase, and we re-fetch on the
 * "post-checkout" return URL.
 */
interface SubscriptionContextValue {
  subscription: Subscription;
  paid: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(
  null,
);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const { user, configured } = useAuth();
  const [subscription, setSubscription] = useState<Subscription>(FREE_SUBSCRIPTION);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!configured || !user) {
      setSubscription(FREE_SUBSCRIPTION);
      return;
    }
    setLoading(true);
    try {
      setSubscription(await fetchSubscription());
    } finally {
      setLoading(false);
    }
  }, [configured, user]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, user]);

  // Detect Stripe checkout return — they redirect with ?checkout=success.
  // Refresh once when we land on that URL; clean it up so reload doesn't
  // re-trigger.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      // Wait a moment for the webhook to land, then refresh.
      const t = window.setTimeout(() => void refresh(), 1500);
      params.delete('checkout');
      const q = params.toString();
      const newUrl =
        window.location.pathname + (q ? `?${q}` : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      subscription,
      paid: isPaid(subscription),
      loading,
      refresh,
    }),
    [subscription, loading, refresh],
  );

  return createElement(SubscriptionContext.Provider, { value }, children);
};

export const useSubscription = (): SubscriptionContextValue => {
  const ctx = useContext(SubscriptionContext);
  if (ctx) return ctx;
  return {
    subscription: FREE_SUBSCRIPTION,
    paid: false,
    loading: false,
    refresh: async () => {},
  };
};
