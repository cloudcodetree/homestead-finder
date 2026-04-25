import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useProjects } from '../hooks/useProjects';
import type { Project, ProjectStatus } from '../lib/api';

/**
 * Kanban-lite projects index. Each status is a column; new projects
 * default to "scouting" and the user moves them along the funnel as
 * the deal progresses (shortlisted → offered → closed).
 *
 * Design intent: the "research desk" page — landing on /projects
 * should feel like opening Trello or a deal pipeline, not a settings
 * screen. Keep the visual rhythm denser than the listing grid so
 * power users can see their full workspace at a glance.
 */

const STATUS_COLUMNS: Array<{
  status: ProjectStatus;
  label: string;
  hint: string;
}> = [
  { status: 'scouting', label: 'Scouting', hint: 'Open exploration' },
  { status: 'shortlisted', label: 'Shortlisted', hint: 'Worth a closer look' },
  { status: 'offered', label: 'Offered', hint: 'Active negotiation' },
  { status: 'closed', label: 'Closed', hint: 'Bought or walked away' },
  { status: 'archived', label: 'Archived', hint: 'Reference / history' },
];

export const ProjectsIndex = () => {
  const { user } = useAuth();
  const { projects, loading, create, update, remove } = useProjects();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Projects</h1>
        <p className="text-gray-600">Sign in to organize your land hunt into projects.</p>
      </div>
    );
  }

  const byStatus = (s: ProjectStatus) => projects.filter((p) => p.status === s);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const row = await create(newName, newDesc || null);
      setNewName('');
      setNewDesc('');
      setShowNew(false);
      navigate(`/project/${row.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">
            One workspace per land-hunt objective. Move projects through the funnel as deals progress.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5"
          >
            ← Back to listings
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            + New project
          </button>
        </div>
      </div>

      {loading && projects.length === 0 ? (
        <p className="text-gray-500">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <p className="text-gray-700 font-medium mb-1">No projects yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Create your first project to start organizing saved searches, pinned listings,
            and notes around a single land-hunt goal.
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {STATUS_COLUMNS.map((col) => {
            const items = byStatus(col.status);
            return (
              <div
                key={col.status}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 min-h-[200px]"
              >
                <div className="mb-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-gray-700">
                    {col.label}{' '}
                    <span className="text-gray-400 font-medium">({items.length})</span>
                  </h2>
                  <p className="text-[10px] text-gray-400">{col.hint}</p>
                </div>
                <div className="space-y-2">
                  {items.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onOpen={() => navigate(`/project/${p.id}`)}
                      onChangeStatus={(s) => void update(p.id, { status: s })}
                      onDelete={() => {
                        if (confirm(`Delete "${p.name}"? Items inside will also be removed.`)) {
                          void remove(p.id);
                        }
                      }}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="text-xs text-gray-400 italic px-1 py-2">No projects in this stage</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New project modal */}
      {showNew && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={onCreate}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3"
          >
            <h2 className="font-bold text-gray-900">New project</h2>
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. 2026 Ozark scouting"
              maxLength={120}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none"
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional — what's the goal of this project?"
              rows={3}
              maxLength={500}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !newName.trim()}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

interface ProjectCardProps {
  project: Project;
  onOpen: () => void;
  onChangeStatus: (s: ProjectStatus) => void;
  onDelete: () => void;
}

const ProjectCard = ({
  project,
  onOpen,
  onChangeStatus,
  onDelete,
}: ProjectCardProps) => {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-2.5 hover:border-green-400 transition-colors group">
      <button onClick={onOpen} className="w-full text-left">
        <p className="text-sm font-medium text-gray-900 truncate">{project.name}</p>
        {project.description && (
          <p className="text-[11px] text-gray-500 truncate">{project.description}</p>
        )}
        <p className="text-[10px] text-gray-400 mt-1">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      </button>
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <select
          value={project.status}
          onChange={(e) => onChangeStatus(e.target.value as ProjectStatus)}
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] border border-gray-200 rounded px-1 py-0"
        >
          {STATUS_COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          onClick={onDelete}
          className="ml-auto text-[10px] text-gray-400 hover:text-red-600"
          title="Delete project"
        >
          Delete
        </button>
      </div>
    </div>
  );
};
