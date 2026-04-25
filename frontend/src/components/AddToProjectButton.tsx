import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useProjects } from '../hooks/useProjects';
import type { ProjectItemType } from '../lib/api';

interface AddToProjectButtonProps {
  itemType: ProjectItemType;
  itemId: string;
  /** Visual label override (defaults to "Add to project"). */
  label?: string;
  /** Render style — modal trigger uses primary, inline buttons use secondary. */
  variant?: 'primary' | 'secondary';
}

/**
 * Reusable "Add to project" affordance. Click → small popover lists
 * the user's projects + a "Create new…" option. Click a project →
 * api.projects.addItem(projectId, itemType, itemId). Idempotent
 * (dedupe upsert in the API layer).
 *
 * Shown only when signed-in. Anonymous users see nothing.
 */
export const AddToProjectButton = ({
  itemType,
  itemId,
  label = 'Add to project',
  variant = 'secondary',
}: AddToProjectButtonProps) => {
  const { user } = useAuth();
  const { projects, create, addItem } = useProjects();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!user) return null;

  const addToExisting = async (projectId: string) => {
    setBusy(true);
    try {
      await addItem(projectId, itemType, itemId);
      const proj = projects.find((p) => p.id === projectId);
      setFeedback(`Added to "${proj?.name ?? 'project'}"`);
      window.setTimeout(() => {
        setFeedback(null);
        setOpen(false);
      }, 1500);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const proj = await create(newName);
      await addItem(proj.id, itemType, itemId);
      setNewName('');
      setCreating(false);
      setFeedback(`Created and added to "${proj.name}"`);
      window.setTimeout(() => {
        setFeedback(null);
        setOpen(false);
      }, 1500);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not create');
    } finally {
      setBusy(false);
    }
  };

  const buttonClass =
    variant === 'primary'
      ? 'bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg'
      : 'inline-flex items-center gap-1 text-xs text-gray-600 hover:text-green-700 border border-gray-200 hover:border-green-300 rounded px-2 py-1';

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((v) => !v)} className={buttonClass}>
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        {label}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setCreating(false);
              setFeedback(null);
            }}
          />
          <div className="absolute right-0 mt-1 z-50 w-64 rounded-lg bg-white border border-gray-200 shadow-xl overflow-hidden">
            {feedback ? (
              <p className="text-xs text-green-700 bg-green-50 px-3 py-2">{feedback}</p>
            ) : null}
            {!creating ? (
              <>
                {projects.length === 0 ? (
                  <p className="text-xs text-gray-500 px-3 py-3">
                    No projects yet. Create one below.
                  </p>
                ) : (
                  <ul className="max-h-60 overflow-y-auto">
                    {projects.map((p) => (
                      <li key={p.id}>
                        <button
                          disabled={busy}
                          onClick={() => void addToExisting(p.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                        >
                          <p className="font-medium text-gray-900 truncate">{p.name}</p>
                          <p className="text-[10px] text-gray-400 capitalize">{p.status}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => setCreating(true)}
                  className="w-full text-left px-3 py-2 text-sm font-medium text-green-700 border-t border-gray-100 hover:bg-green-50"
                >
                  + Create new project
                </button>
              </>
            ) : (
              <form onSubmit={createAndAdd} className="p-3 space-y-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Project name"
                  maxLength={120}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !newName.trim()}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-medium px-2 py-1 rounded"
                  >
                    Create &amp; add
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
};
