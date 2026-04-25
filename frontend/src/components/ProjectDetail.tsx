import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useProjects, useProjectItems } from '../hooks/useProjects';
import { useProperties } from '../hooks/useProperties';
import { useQueryServer } from '../hooks/useQueryServer';
import { DEFAULT_FILTERS } from '../types/property';
import { api, type Project, type ProjectStatus } from '../lib/api';
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

type TabKey = 'listings' | 'searches' | 'notes' | 'files' | 'chat';

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
            ['files', 'Files'],
            ['chat', 'Chat'],
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
        ) : tab === 'notes' ? (
          <NotesTab projectId={project.id} />
        ) : tab === 'files' ? (
          <FilesTab projectId={project.id} />
        ) : (
          <ChatTab projectId={project.id} />
        )}
      </div>
    </div>
  );
};

// ── Chat tab ──────────────────────────────────────────────────────

interface ChatTabProps {
  projectId: string;
}

interface ChatTurn {
  question: string;
  matches: Array<{ id: string; reason: string; title?: string }>;
  error?: string;
}

const ChatTab = ({ projectId }: ChatTabProps) => {
  const navigate = useNavigate();
  const { status, ask } = useQueryServer();
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [contextChars, setContextChars] = useState<number | null>(null);

  // Build the project context: project_files extracted_text concatenated
  // with a header per file so the AI can tell them apart. Recomputed
  // before each ask so newly-extracted files flow in without a reload.
  const buildProjectContext = useCallback(async (): Promise<string> => {
    const files = await api.projects.listFiles(projectId);
    const note = await api.projects.getNote(projectId);
    const parts: string[] = [];
    if (note.trim()) {
      parts.push(`## Project notes\n${note}`);
    }
    for (const f of files) {
      if (!f.extractedText) {
        parts.push(`## ${f.filename} (still processing)`);
        continue;
      }
      // Cap each file at ~50K chars so one outsize PDF doesn't drown
      // out the others. Server caps the whole payload at 1MB anyway.
      const trimmed = f.extractedText.slice(0, 50_000);
      parts.push(`## ${f.filename}\n${trimmed}`);
    }
    return parts.join('\n\n---\n\n');
  }, [projectId]);

  // Resolve listing titles from the global corpus so chat results
  // show useful headers, not just opaque IDs.
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allProperties) m.set(p.id, p.title);
    return m;
  }, [allProperties]);

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const ctx = await buildProjectContext();
      setContextChars(ctx.length);
      const resp = await ask(q, 10, ctx);
      const turn: ChatTurn = {
        question: q,
        matches: resp.matches.map((m) => ({
          id: m.id,
          reason: m.reason,
          title: titleById.get(m.id),
        })),
      };
      setHistory((h) => [turn, ...h]);
      setQuestion('');
    } catch (err) {
      setHistory((h) => [
        {
          question: q,
          matches: [],
          error: err instanceof Error ? err.message : 'Request failed',
        },
        ...h,
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'checking') {
    return <p className="text-sm text-gray-500">Checking AI server…</p>;
  }
  if (status === 'unavailable') {
    return (
      <div className="text-sm text-gray-700 space-y-2">
        <p>
          AI chat needs the local query server running. Per ADR-012, AI
          inference runs on your machine via{' '}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">claude -p</code>
          {' '}so we don&apos;t pay API credits on top of the Max subscription.
        </p>
        <p className="text-xs text-gray-500">
          Start it with{' '}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
            cd scraper &amp;&amp; python -m query_server
          </code>
          {' '}then reload this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-700 mb-1">
          Ask anything that uses your project&apos;s context. Files (extracted
          text) and notes are sent along with each question. Results are listings
          ranked by relevance to your question + context.
        </p>
        <p className="text-[11px] text-gray-400">
          Examples: <em>&ldquo;Which of my pinned listings actually match
          the budget in my offer letter PDF?&rdquo;</em> · <em>&ldquo;Find listings
          like the cabin I rated 😄 but under $80k.&rdquo;</em>
        </p>
      </div>

      <form onSubmit={onAsk} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask about this project…"
          disabled={busy}
          className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {contextChars !== null && (
        <p className="text-[11px] text-gray-400">
          Last query used {contextChars.toLocaleString()} chars of project
          context (notes + extracted file text).
        </p>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No questions yet. Your project chat history lives here for the
          session — it&apos;s not persisted across reloads (yet).
        </p>
      ) : (
        <ul className="space-y-3">
          {history.map((t, i) => (
            <li key={i} className="border border-gray-100 rounded p-3">
              <p className="text-sm font-medium text-gray-900 mb-2">
                <span className="text-gray-400">Q:</span> {t.question}
              </p>
              {t.error ? (
                <p className="text-sm text-red-600">Error: {t.error}</p>
              ) : t.matches.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No matches.</p>
              ) : (
                <ul className="space-y-1.5">
                  {t.matches.map((m) => (
                    <li
                      key={m.id}
                      className="border-l-2 border-green-300 pl-2 cursor-pointer hover:bg-green-50/40"
                      onClick={() => navigate(`/p/${m.id}`)}
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {m.title ?? m.id}
                      </p>
                      <p className="text-xs text-gray-600">{m.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
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

// ── Files tab ─────────────────────────────────────────────────────

interface FilesTabProps {
  projectId: string;
}

const FilesTab = ({ projectId }: FilesTabProps) => {
  const [files, setFiles] = useState<
    Awaited<ReturnType<typeof api.projects.listFiles>>
  >([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await api.projects.listFiles(projectId));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setUploading(true);
    try {
      await api.projects.uploadFile(projectId, f);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset the input so picking the same file twice still fires onChange
      e.target.value = '';
    }
  };

  const onDownload = async (storagePath: string, filename: string) => {
    const url = await api.projects.getFileSignedUrl(storagePath, 60);
    if (!url) {
      setError('Could not generate download link');
      return;
    }
    // Open in a new tab; browsers auto-download types they can't render
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = filename;
    a.click();
  };

  const onDelete = async (id: string, filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      await api.projects.deleteFile(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">
          Inspection PDFs, surveys, comparable-sales printouts, owner-finance term sheets.
          Up to 10MB per file.
        </p>
        <label
          className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 cursor-pointer ${
            uploading
              ? 'bg-gray-300 text-gray-500'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {uploading ? 'Uploading…' : '+ Upload file'}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void onPick(e)}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {loading && files.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-gray-500">
          No files yet. Drop a PDF, image, or spreadsheet to attach it to this
          project.
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 border border-gray-100 rounded p-2 hover:border-green-400 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{f.filename}</p>
                <p className="text-xs text-gray-500">
                  {(f.sizeBytes / 1024).toFixed(0)} KB · {f.contentType || 'unknown'} ·{' '}
                  {new Date(f.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => void onDownload(f.storagePath, f.filename)}
                className="text-xs text-gray-600 hover:text-green-700 font-medium"
              >
                Download
              </button>
              <button
                onClick={() => void onDelete(f.id, f.filename)}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-gray-400 mt-3 italic">
        Storage layer ready. AI-context wiring (in-project AskClaude pulls
        file contents) ships in a follow-up increment with the text-extraction
        worker.
      </p>
    </div>
  );
};

interface NotesTabProps {
  projectId: string;
}

const NotesTab = ({ projectId }: NotesTabProps) => {
  const [text, setText] = useState('');
  const [persistedText, setPersistedText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading');
  const debounceTimer = useRef<number | null>(null);

  // Load existing note from Supabase (preferring cloud) on mount;
  // fall back to a localStorage cache for offline first-paint.
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `project_note_${projectId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) {
      setText(cached);
      setPersistedText(cached);
    }
    setStatus('loading');
    void api.projects.getNote(projectId).then((cloud) => {
      if (cancelled) return;
      setText(cloud);
      setPersistedText(cloud);
      localStorage.setItem(cacheKey, cloud);
      setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced save: every keystroke updates local state instantly +
  // localStorage cache; cloud upsert fires 1s after last keystroke.
  // On blur we flush immediately.
  const commit = useCallback(
    async (next: string) => {
      if (next === persistedText) return;
      setStatus('saving');
      try {
        await api.projects.upsertNote(projectId, next);
        setPersistedText(next);
        setStatus('saved');
        window.setTimeout(() => setStatus('idle'), 1500);
      } catch {
        setStatus('error');
      }
    },
    [projectId, persistedText],
  );

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);
    localStorage.setItem(`project_note_${projectId}`, next);
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => void commit(next), 1000);
  };

  const onBlur = () => {
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    void commit(text);
  };

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        window.clearTimeout(debounceTimer.current);
        void commit(text);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          Markdown supported when we wire the renderer; for now plain text.
        </p>
        <span className="text-[11px] text-gray-400">
          {status === 'loading' && 'Loading…'}
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && '✓ Saved'}
          {status === 'error' && (
            <span className="text-red-500">Couldn&apos;t save (cached locally)</span>
          )}
        </span>
      </div>
      <textarea
        value={text}
        onChange={onChange}
        onBlur={onBlur}
        rows={12}
        placeholder="Notes for this project — research findings, contacts, contingencies, comps you want to remember. Cloud-synced across devices."
        className="w-full border border-gray-200 rounded p-3 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y"
      />
    </div>
  );
};
