import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { OnboardingModal } from '../OnboardingModal';

/**
 * Page-mode onboarding at /onboarding. Anonymous users get bounced
 * to landing — the form has no meaning without a user row to attach
 * preferences to. Save / skip both navigate to /home; the
 * OnboardingModal calls our onClose after persisting.
 */
export const OnboardingPage = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/landing" replace />;
  return <OnboardingModal asPage onClose={() => navigate('/home')} />;
};
