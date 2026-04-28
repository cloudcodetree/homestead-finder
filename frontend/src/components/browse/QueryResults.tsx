import { Property } from '../../types/property';
import { QueryResponse } from '../../hooks/useQueryServer';
import { PropertyCard } from '../PropertyCard';

interface QueryResultsProps {
  result: QueryResponse;
  /** Full corpus — Claude picked from all listings, not the filtered
   * set, so we look matches up here instead of in `properties`. */
  allProperties: Property[];
  selectedId: string | null;
  onOpenProperty: (id: string) => void;
}

/**
 * Pinned section above the regular list when an Ask-Claude query is
 * active. Shows Claude's ranked picks with each pick's reasoning
 * inline. Hides automatically when no query is active (parent
 * controls the boolean by rendering or not).
 */
export const QueryResults = ({
  result,
  allProperties,
  selectedId,
  onOpenProperty,
}: QueryResultsProps) => (
  <section className="max-w-6xl mx-auto mb-6 bg-purple-50/50 border border-purple-200 rounded-xl p-4">
    <header className="flex items-center gap-2 mb-3">
      <span className="text-sm font-semibold text-purple-900">
        Claude&apos;s picks for{' '}
        <em className="font-medium text-purple-700">
          &ldquo;{result.question}&rdquo;
        </em>
      </span>
      <span className="text-xs text-purple-600">
        {result.matches.length} of {result.totalConsidered}
      </span>
    </header>
    {result.matches.length === 0 ? (
      <p className="text-sm text-gray-600 py-2">
        No listings matched. Try rephrasing or broadening your criteria.
      </p>
    ) : (
      <div className="space-y-3">
        {result.matches.map((match, i) => {
          const p = allProperties.find((x) => x.id === match.id);
          if (!p) return null;
          return (
            <div key={match.id} className="flex gap-3 items-start">
              <div className="flex-shrink-0 w-8 text-center pt-4 text-xs font-bold text-purple-700">
                #{i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <PropertyCard
                  property={p}
                  onClick={onOpenProperty}
                  isSelected={selectedId === p.id}
                />
                <p className="mt-1 text-xs text-purple-700 bg-white border border-purple-200 rounded px-2 py-1">
                  <span className="font-semibold">Claude: </span>
                  {match.reason}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </section>
);
