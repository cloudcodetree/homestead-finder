import { useNavigate } from 'react-router-dom';
import { useFilters } from '../../hooks/useFilters';
import { SavedSearchesModal } from '../SavedSearchesModal';

/**
 * Page-mode saved-searches view at /saved-searches. Uses the same
 * useFilters hook the Dashboard uses (it's URL-backed) so the
 * "save current filters" form captures whatever the user just had
 * applied on the Dashboard before navigating here. Apply navigates
 * back to / with the chosen filters re-applied.
 */
export const SavedSearchesPage = () => {
  const navigate = useNavigate();
  const { filters, replaceFilters } = useFilters();
  return (
    <SavedSearchesModal
      currentFilters={filters}
      onApply={(f) => {
        replaceFilters(f);
        navigate('/browse');
      }}
    />
  );
};
