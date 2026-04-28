import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProperties } from '../../hooks/useProperties';
import { DEFAULT_FILTERS } from '../../types/property';
import { PropertyDetail } from '../PropertyDetail';

/**
 * Page-mode property detail at /p/:id. Looks up the listing in the
 * full corpus (not the filtered set) so a deep-linked URL always
 * resolves regardless of the user's last filter state. Back button
 * in PropertyDetail's header navigates one step back in history,
 * landing the user back where they came from (browse, swipe, map).
 */
export const PropertyDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { allProperties, loading } = useProperties(DEFAULT_FILTERS);
  const property = id ? allProperties.find((p) => p.id === id) ?? null : null;

  if (loading && !property) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="inline-block w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="p-10 text-center">
        <p className="text-gray-700 font-medium mb-1">Listing not found</p>
        <p className="text-sm text-gray-500 mb-3">
          It may have expired or been removed from the corpus.
        </p>
        <Link to="/" className="text-green-600 hover:text-green-700 text-sm font-medium">
          ← Back to listings
        </Link>
      </div>
    );
  }

  return <PropertyDetail property={property} onClose={() => navigate(-1)} />;
};
