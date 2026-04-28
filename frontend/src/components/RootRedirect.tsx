import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Anonymous users hitting `/` get the marketing page; signed-in
 * users get their personalized feed. Mounts at the literal root so
 * we never render the bare Dashboard as the landing experience.
 *
 * While auth status is loading we render nothing — better than
 * flashing the landing page and immediately redirecting away.
 */
export const RootRedirect = () => {
  const { user, loading, configured } = useAuth();
  if (loading) return null;
  // When Supabase isn't configured at all, treat as anonymous so
  // local dev still has somewhere to land.
  const target = configured && user ? '/home' : '/landing';
  return <Navigate to={target} replace />;
};
