import { SortBy, SORT_LABELS } from '../../types/property';

interface ListToolbarProps {
  /** Headline count — "1234 properties" or "All listings" when a
   * Claude query is pinned. */
  headline: string;
  /** When true, surface the "Showing hidden listings only" mode banner. */
  onlyHidden: boolean;
  onExitHiddenMode: () => void;
  /** Saved chip — only rendered when caller wants it (signed-in user). */
  showSavedChip: boolean;
  onlySaved: boolean;
  onToggleOnlySaved: () => void;
  savedCount: number;
  /** Hidden-toggle chip — only when there's at least one hidden listing. */
  showHiddenChip: boolean;
  showHidden: boolean;
  onToggleShowHidden: () => void;
  hiddenCount: number;
  /** Sort selector. */
  sortBy: SortBy;
  onChangeSort: (s: SortBy) => void;
  /** Whether the "Recommended for you" sort option should be visible.
   * Hidden until the user has fitted ranking weights. */
  hasRankingData: boolean;
}

/**
 * The header strip above the listings grid. Owns the "saved-only" /
 * "show hidden" / "hidden mode" chips plus the sort selector.
 *
 * No internal state — every toggle calls back to the parent so the
 * parent stays the single source of truth for filter state. Pure
 * presentation; easy to unit-test by feeding props.
 */
export const ListToolbar = ({
  headline,
  onlyHidden,
  onExitHiddenMode,
  showSavedChip,
  onlySaved,
  onToggleOnlySaved,
  savedCount,
  showHiddenChip,
  showHidden,
  onToggleShowHidden,
  hiddenCount,
  sortBy,
  onChangeSort,
  hasRankingData,
}: ListToolbarProps) => (
  <div className="flex items-center justify-between mb-4 max-w-6xl mx-auto">
    <div className="flex items-center gap-3">
      <p className="text-sm text-gray-500">{headline}</p>
      {onlyHidden && (
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <span>Showing hidden listings only</span>
          <button
            onClick={onExitHiddenMode}
            className="text-gray-500 hover:text-gray-900 underline"
          >
            Exit
          </button>
        </div>
      )}
      {showSavedChip && (
        <button
          onClick={onToggleOnlySaved}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
            onlySaved
              ? 'bg-amber-400 border-amber-500 text-white'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
          title={
            onlySaved
              ? 'Showing saved only — click to show all'
              : `Show only your saved listings (${savedCount})`
          }
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3 h-3"
            fill={onlySaved ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
          <span>Saved {savedCount > 0 ? savedCount : ''}</span>
        </button>
      )}
      {showHiddenChip && (
        <button
          onClick={onToggleShowHidden}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
            showHidden
              ? 'bg-gray-600 border-gray-700 text-white'
              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
          title={
            showHidden
              ? 'Showing hidden listings — click to hide them again'
              : `Show ${hiddenCount} hidden listings`
          }
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          <span>
            {showHidden ? 'Hiding' : 'Show'} hidden ({hiddenCount})
          </span>
        </button>
      )}
    </div>
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 hidden sm:block" htmlFor="sort-select">
        Sort:
      </label>
      <select
        id="sort-select"
        value={sortBy}
        onChange={(e) => onChangeSort(e.target.value as SortBy)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-1 focus:ring-green-500 focus:outline-none"
      >
        {(Object.keys(SORT_LABELS) as SortBy[])
          .filter((opt) => opt !== 'recommended' || hasRankingData)
          .map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
      </select>
    </div>
  </div>
);
