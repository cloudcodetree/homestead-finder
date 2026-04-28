import { Property } from '../../types/property';
import { PropertyCard } from '../PropertyCard';

interface ListingsGridProps {
  properties: Property[];
  selectedId: string | null;
  onOpenProperty: (id: string) => void;
  /** Empty-state CTA — typically resets filters. */
  onResetFilters: () => void;
}

/**
 * The actual cards grid. Renders an empty-state with a "clear
 * filters" CTA when there's nothing to show. Pure presentation —
 * filtering/sorting happens upstream.
 */
export const ListingsGrid = ({
  properties,
  selectedId,
  onOpenProperty,
  onResetFilters,
}: ListingsGridProps) => {
  if (properties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-4xl mb-3" aria-hidden="true">🌾</p>
        <p className="text-gray-600 font-medium">No properties match your filters</p>
        <button
          onClick={onResetFilters}
          className="mt-3 text-green-600 hover:text-green-700 text-sm font-medium"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-6xl mx-auto">
      {properties.map((property) => (
        <PropertyCard
          key={property.id}
          property={property}
          onClick={onOpenProperty}
          isSelected={selectedId === property.id}
        />
      ))}
    </div>
  );
};
