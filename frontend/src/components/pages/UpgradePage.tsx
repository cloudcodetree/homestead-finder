import { useNavigate, useSearchParams } from 'react-router-dom';
import { UpgradeModal } from '../UpgradeModal';

const REASONS = new Set([
  'saved_listings_limit',
  'projects_limit',
  'recommended_sort',
  'ai_enrichment',
  'generic',
]);

/**
 * Page-mode upgrade view at /upgrade. Reuses the same content as
 * the modal — `?reason=` survives in the URL so a paywall hit from
 * anywhere can deep-link to the right copy.
 */
export const UpgradePage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raw = params.get('reason');
  const reason = raw && REASONS.has(raw)
    ? (raw as 'saved_listings_limit' | 'projects_limit' | 'recommended_sort' | 'ai_enrichment' | 'generic')
    : 'generic';

  return (
    <UpgradeModal
      open
      asPage
      reason={reason}
      onClose={() => navigate(-1)}
    />
  );
};
