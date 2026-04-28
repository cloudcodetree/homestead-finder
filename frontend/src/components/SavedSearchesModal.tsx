import { useState } from 'react';
import { FilterState } from '../types/property';
import { useSavedSearches } from '../hooks/useSavedSearches';
import type { NotifyCadence, SavedSearch } from '../lib/api';
import { AddToProjectButton } from './AddToProjectButton';

interface SavedSearchesModalProps {
  /** Current filter state from the Dashboard. Lets the user save
   * exactly what they're looking at. */
  currentFilters: FilterState;
  /** Called when the user clicks "Apply" on a saved search. Parent
   * replaces the dashboard's filter state with the saved one. */
  onApply: (filters: FilterState) => void;
}

const CADENCE_LABELS: Record<NotifyCadence, string> = {
  none: 'No alerts',
  daily: 'Daily',
  weekly: 'Weekly',
};

/**
 * Modal for managing saved searches:
 *   - "Save current filters" input + button (top)
 *   - List of existing searches with apply / cadence / delete
 *
 * Rendered from the account menu's "Saved searches" item.
 */
export const SavedSearchesModal = ({
  currentFilters,
  onApply,
}: SavedSearchesModalProps) => {
  const { searches, loading, create, update, remove } = useSavedSearches();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<NotifyCadence>('daily');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await create(name, currentFilters as unknown as Record<string, unknown>, cadence);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto mx-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Saved searches</h2>
        </div>

        <form onSubmit={onSave} className="px-4 py-3 border-b border-gray-100 space-y-2">
          <label className="block text-xs text-gray-500">
            Save current filters
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ozark homestead < $100k"
            maxLength={80}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
          <div className="flex items-center gap-2">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as NotifyCadence)}
              className="text-sm border border-gray-200 rounded px-2 py-1.5"
            >
              <option value="daily">Email me daily</option>
              <option value="weekly">Email me weekly</option>
              <option value="none">Don&apos;t email me</option>
            </select>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="ml-auto bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium rounded px-3 py-1.5"
            >
              Save
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>

        <div className="px-4 py-3">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {!loading && searches.length === 0 && (
            <p className="text-sm text-gray-500">
              No saved searches yet. Save one above to get alerts when new
              listings match.
            </p>
          )}
          <ul className="space-y-2">
            {searches.map((s) => (
              <SavedSearchRow
                key={s.id}
                search={s}
                onApply={() => onApply(s.filters as unknown as FilterState)}
                onUpdate={(patch) => update(s.id, patch)}
                onRemove={() => remove(s.id)}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

interface SavedSearchRowProps {
  search: SavedSearch;
  onApply: () => void;
  onUpdate: (patch: Partial<Pick<SavedSearch, 'name' | 'notifyCadence'>>) => Promise<void>;
  onRemove: () => void;
}

const SavedSearchRow = ({
  search,
  onApply,
  onUpdate,
  onRemove,
}: SavedSearchRowProps) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="border border-gray-100 rounded px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{search.name}</p>
          <p className="text-xs text-gray-500">
            Saved {new Date(search.createdAt).toLocaleDateString()}
            {search.lastNotifiedAt && ' · alerted ' +
              new Date(search.lastNotifiedAt).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={onApply}
          className="text-xs font-medium text-green-600 hover:text-green-700 px-2 py-1"
        >
          Apply
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          value={search.notifyCadence}
          onChange={(e) =>
            void onUpdate({ notifyCadence: e.target.value as NotifyCadence })
          }
          className="text-xs border border-gray-200 rounded px-1.5 py-0.5"
        >
          {Object.entries(CADENCE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <AddToProjectButton
          itemType="saved_search"
          itemId={search.id}
          label="Add to project"
        />
        {confirming ? (
          <div className="ml-auto flex items-center gap-1 text-xs">
            <button
              onClick={onRemove}
              className="text-red-600 hover:text-red-700 font-medium"
            >
              Delete
            </button>
            <span className="text-gray-400">·</span>
            <button
              onClick={() => setConfirming(false)}
              className="text-gray-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="ml-auto text-xs text-gray-400 hover:text-red-600"
            aria-label="Delete saved search"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
};
