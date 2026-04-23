import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

/**
 * Fetch the signed-in user's personalization weights from
 * user_ranking_weights. Returns null until loaded or if the user
 * doesn't have a fitted model yet.
 *
 * Loads once per auth change. Does NOT poll — the nightly rank_fit
 * worker updates weights at most once per 23h.
 */
interface RankingWeights {
  weights: Record<string, number>;
  numExamples: number;
  fittedAt: string;
}

/** Minimum training examples before we surface the Recommended sort.
 * Below this the model is too unreliable to personalize. */
export const MIN_EXAMPLES_FOR_RECOMMENDED = 8;

export const useRankingWeights = () => {
  const { user, configured } = useAuth();
  const [state, setState] = useState<RankingWeights | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!configured || !user || !supabase) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from('user_ranking_weights')
      .select('weights, num_examples, fitted_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          setState(null);
          return;
        }
        setState({
          weights: (data.weights as Record<string, number>) ?? {},
          numExamples: (data.num_examples as number) ?? 0,
          fittedAt: (data.fitted_at as string) ?? '',
        });
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, user]);

  const hasEnoughData =
    state !== null && state.numExamples >= MIN_EXAMPLES_FOR_RECOMMENDED;

  return { weights: state?.weights ?? null, hasEnoughData, loading };
};
