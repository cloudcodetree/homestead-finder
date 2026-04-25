import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useProjects, useProjectItems } from '../hooks/useProjects';
import { useProperties } from '../hooks/useProperties';
import { DEFAULT_FILTERS } from '../types/property';
import type { Project, ProjectStatus } from '../lib/api';
import { formatPrice, formatAcreage, formatCountyState } from '../utils/formatters';

/**
 * Project detail page. Header shows name (inline-editable),
 * description, status selector, delete button. Body has 3 tabs:
 *   - Listings: pinned property cards
 *   - Searches: saved-search shortcuts (run them from here)
 *   - Notes: freeform markdown (single textarea v1; multi-note v2)
 *
 * Files tab + chat tab land in the next increment with the
 * project_files migration.
 */

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'scouting', label: 'Scouting' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'offered', label: 'Offered' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
];

type TabKey = 'listings' | 'searches' | 'notes';

export const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, update, remove } = useProjects();
  const { items, loading, refresh, remove: removeItem } = useProjectItems(id ?? null);
  const project = useMemo<Project | undefined>(
    () => projects.find((p) => p.id === id),
    [projects, id],
  );

  const [tab, setTab] = useState<TabKey>('listings');
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  useEffect(() => {
    if (project) {
      setDraftName(project.name);
      setDraftDesc(project.description ?? '');
    }
  }, [project]);

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center">
        <p className="text-gray-600">Sign in to view this project.</p>
      </div>
    );
  }

  if (!project) {
    // projects haven't loaded yet OR project doesn't exist / belongs to another user
    return (
      <div className="max-w-4xl mx-auto p-8 text-center">
        <p className="text-gray-500">Loading project…</p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 text-sm text-gray-600 hover:text-gray-900 underline"
        >
          ← Back to projects
        </button>
      </div>
    );
  }

  const listings = items.filter((i) => i.itemType === 'listing');
  const searches = items.filter((i) => i.itemType === 'saved_search');

  const saveName = async () => {
    if (draftName.trim() && draftName !== project.name) {
      await update(project.id, { name: draftName.trim() });
    }
    setEditingName(false);
  };

  const onDelete = async () => {
    if (confirm(`Delete "${project.name}"? Items inside will also be removed.`)) {
      await remove(project.id);
      navigate('/projects');
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/projects')}
          className="text-sm text-gray-600 hover:text-gray-900 mb-3"
        >
          ← All projects
        </button>
        {/* Header */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editingName ? (
                <input
                  autoFocus
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName();
                    if (e.key === 'Escape') {
                      setDraftName(project.name);
                      setEditingName(false);
                    }
                  }}
                  className="text-xl font-bold text-gray-900 border-b-2 border-green-400 focus:outline-none w-full"
                />
              ) : (
                <h1
                  onClick={() => setEditingName(true)}
                  className="text-xl font-bold text-gray-900 cursor-text hover:bg-gray-50 -mx-1 px-1 rounded"
                  title="Click to rename"
                >
                  {project.name}
                </h1>
              )}
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                onBlur={() => {
                  if (draftDesc !== (project.description ?? '')) {
                    void update(project.id, { description: draftDesc });
                  }
                }}
                placeholder="Description (optional)…"
                rows={1}
                className="mt-1 w-full text-sm text-gray-600 bg-transparent resize-none focus:outline-none focus:bg-gray-50 px-1 -mx-1 rounded"
              />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <select
                value={project.status}
                onChange={(e) =>
                  void update(project.id, {
                    status: e.target.value as ProjectStatus,
                  })
                }
                className="text-xs border border-gray-200 rounded px-2 py-1"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void onDelete()}
                className="text-xs text-gray-400 hover:text-red-600"
                title="Delete project"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(
          [
            ['listings', `Pinned listings (${listings.length})`],
            ['searches', `Saved searches (${searches.length})`],
            ['notes', 'Notes'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as TabKey)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : tab === 'listings' ? (
          <ListingsTab
            listingIds={listings.map((i) => i.itemId)}
            itemRowsByListingId={Object.fromEntries(
              listings.map((i) => [i.itemId, i.id]),
            )}
            onRemove={async (rowId) => {
              await removeItem(rowId);
              await refresh();
            }}
          />
        ) : tab === 'searches' ? (
          <SearchesTab
            items={searches.map((i) => ({ rowId: i.id, savedSearchId: i.itemId }))}
            onRemove={async (rowId) => {
              await removeItem(rowId);
              await refresh();
            }}
          />
        ) : (
          <NotesTab projectId={project.id} />
        )}
      </div>
    </div>
  );
};

// ── Listings tab ────────────────────────────────────────────────────

interface ListingsTabProps {
  listingIds: string[];
  itemRowsByListingId: Record<string, string>;
  onRemove: (rowId: string) => Promise<void>;
}

const ListingsTab = ({
  listingIds,
  itemRowsByListingId,
  onRemove,
}: ListingsTabProps) => {
  const navigate = useNavigate();
  // Reuse the global properties hook to find listing details. Cheap —
  // the listings.json is already loaded for the dashboard.
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  const matched = useMemo(
    () => allProperties.filter((p) => listingIds.includes(p.id)),
    [allProperties, listingIds],
  );

  if (listingIds.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No listings pinned yet. Pin from the property detail page or list view via
        the &ldquo;Add to project&rdquo; button.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {matched.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-3 border border-gray-100 rounded p-2 hover:border-green-400 transition-colors"
        >
          <button
            onClick={() => navigate(`/p/${p.id}`)}
            className="flex-1 text-left min-w-0"
          >
            <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
            <p className="text-xs text-gray-500">
              {formatPrice(p.price)} · {formatAcreage(p.acreage)} ·{' '}
              {formatCountyState(p.location.county, p.location.state)}
            </p>
          </button>
          <button
            onClick={() => void onRemove(itemRowsByListingId[p.id])}
            className="text-xs text-gray-400 hover:text-red-600"
            title="Remove from project"
          >
            ✕
          </button>
        </div>
      ))}
      {matched.length < listingIds.length && (
        <p className="text-[11px] text-gray-400 italic">
          {listingIds.length - matched.length} listing(s) no longer in current corpus
        </p>
      )}
    </div>
  );
};

// ── Searches tab ─────────────────────────────────────────────────────

interface SearchesTabProps {
  items: Array<{ rowId: string; savedSearchId: string }>;
  onRemove: (rowId: string) => Promise<void>;
}

const SearchesTab = ({ items, onRemove }: SearchesTabProps) => {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No saved searches in this project. Add one from the Saved Searches modal
        (account menu).
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div
          key={it.rowId}
          className="flex items-center justify-between border border-gray-100 rounded p-2"
        >
          <p className="text-sm font-mono text-gray-700 truncate">
            search:{it.savedSearchId.slice(0, 8)}…
          </p>
          <button
            onClick={() => void onRemove(it.rowId)}
            className="text-xs text-gray-400 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
};

// ── Notes tab ─────────────────────────────────────────────────────────

interface NotesTabProps {
  projectId: string;
}

const NotesTab = ({ projectId }: NotesTabProps) => {
  // v1: stub — single placeholder textarea backed by localStorage so
  // the tab isn't empty during testing. Real persistence to
  // project_notes table comes in the next increment along with the
  // file/chat tabs.
  const [text, setText] = useState(() => {
    return localStorage.getItem(`project_note_${projectId}`) ?? '';
  });
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          localStorage.setItem(`project_note_${projectId}`, next);
        }}
        rows={10}
        placeholder="Notes for this project — markdown supported when we wire the renderer in the next increment. Persisted locally for now; cloud sync to project_notes table coming soon."
        className="w-full border border-gray-200 rounded p-3 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y"
      />
      <p className="text-[11px] text-gray-400 mt-2 italic">
        Local-only persistence in this increment. Cloud sync + markdown render
        ship with the file/chat tabs.
      </p>
    </div>
  );
};
