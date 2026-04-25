import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Vendor-abstraction layer over Supabase.
 *
 * All Supabase-specific code lives in this file. Components call
 * `api.auth.*` and `api.savedListings.*` without knowing which
 * backend implements them. When we need to migrate off Supabase
 * (self-hosted GoTrue, AWS Cognito + RDS, Clerk, etc.), only this
 * file changes — the 20+ call sites in components / hooks stay
 * exactly as-is.
 *
 * Each method returns plain types (User / string[]) rather than
 * Supabase-specific types at the public surface, so consumers don't
 * leak vendor types throughout the codebase.
 */

const SAVED_LISTINGS_TABLE = 'saved_listings';

// ── Auth ─────────────────────────────────────────────────────────

const getUser = async (): Promise<User | null> => {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

const signInWithGoogle = async (): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Return to the current page after OAuth — avoids bouncing back
      // to "/" and losing whatever listing / filter the user was on.
      redirectTo: window.location.href,
    },
  });
  if (error) throw error;
};

/**
 * Email magic-link (aka OTP). Supabase sends a one-time sign-in
 * link to the email; clicking it opens `redirectTo` with a session
 * cookie, same effect as completing an OAuth round-trip. No password
 * ever gets set — this is passwordless by design. Returns silently
 * on success so the caller can render "check your inbox" UI.
 */
const signInWithEmail = async (email: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const trimmed = email.trim();
  if (!trimmed) throw new Error('Email required');
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: window.location.href,
    },
  });
  if (error) throw error;
};

const signOut = async (): Promise<void> => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

/**
 * Subscribe to auth state changes. Returns an unsubscribe function
 * for the effect-cleanup convention.
 */
const onAuthChange = (cb: (user: User | null) => void): (() => void) => {
  if (!supabase) {
    cb(null);
    return () => {};
  }
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
};

// ── Saved listings ───────────────────────────────────────────────

/**
 * Return the saved-listings set for the current user as a map of
 * listingId → optional note text. Empty map if not logged in or if
 * Supabase isn't configured.
 *
 * Returning a record (rather than just ids) lets consumers render the
 * note inline without a second round-trip per listing detail open.
 * Notes are usually empty, so payload stays small.
 */
export interface SavedListingRow {
  listingId: string;
  note: string;
}

const listSaved = async (): Promise<SavedListingRow[]> => {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .select('listing_id, note')
    .eq('user_id', user.id);
  if (error || !data) return [];
  return data.map((r) => ({
    listingId: r.listing_id as string,
    note: (r.note as string | null) ?? '',
  }));
};

/**
 * Update (or clear) the private note on a saved listing. The row must
 * already exist — caller is responsible for toggling the save first.
 * Passing an empty string clears the note column.
 */
const updateNote = async (listingId: string, note: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const trimmed = note.trim();
  const { error } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .update({ note: trimmed ? trimmed : null })
    .eq('user_id', user.id)
    .eq('listing_id', listingId);
  if (error) throw error;
};

/**
 * Toggle a listing's saved state for the current user. Returns the
 * new state (true = saved, false = removed). Throws if the user
 * isn't logged in — UI should gate the bookmark button on auth.
 */
const toggleSaved = async (listingId: string): Promise<boolean> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');

  // Check current state first so we return the correct new value
  const { data: existing } = await supabase
    .from(SAVED_LISTINGS_TABLE)
    .select('listing_id')
    .eq('user_id', user.id)
    .eq('listing_id', listingId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from(SAVED_LISTINGS_TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('listing_id', listingId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from(SAVED_LISTINGS_TABLE)
      .insert({ user_id: user.id, listing_id: listingId });
    if (error) throw error;
    return true;
  }
};

// ── Listing ratings ──────────────────────────────────────────────

const LISTING_RATINGS_TABLE = 'listing_ratings';

/** Domain of stored ratings. We never persist 0 — clearing to Meh
 * deletes the row instead, keeping the table compact. */
export type ListingRating = -2 | -1 | 1 | 2;

/** Returns map of {listingId → rating} for the signed-in user. */
async function listRatings(): Promise<Map<string, ListingRating>> {
  if (!supabase) return new Map();
  const user = await getUser();
  if (!user) return new Map();
  const { data, error } = await supabase
    .from(LISTING_RATINGS_TABLE)
    .select('listing_id, rating')
    .eq('user_id', user.id);
  if (error || !data) return new Map();
  const map = new Map<string, ListingRating>();
  for (const r of data) {
    map.set(r.listing_id as string, r.rating as ListingRating);
  }
  return map;
}

/** Set or clear a rating. Pass `null` (or 0) to clear → row deleted. */
async function setRating(
  listingId: string,
  rating: ListingRating | null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  if (rating === null) {
    const { error } = await supabase
      .from(LISTING_RATINGS_TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('listing_id', listingId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from(LISTING_RATINGS_TABLE)
    .upsert(
      { user_id: user.id, listing_id: listingId, rating },
      { onConflict: 'user_id,listing_id' },
    );
  if (error) throw error;
}

// ── Hidden listings ──────────────────────────────────────────────

const HIDDEN_LISTINGS_TABLE = 'hidden_listings';

/** IDs the current user has marked "not interested". Empty array when
 * not signed in or Supabase isn't configured — consumers treat it as
 * "nothing hidden". */
const listHidden = async (): Promise<string[]> => {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(HIDDEN_LISTINGS_TABLE)
    .select('listing_id')
    .eq('user_id', user.id);
  if (error || !data) return [];
  return data.map((r) => r.listing_id as string);
};

/** Toggle a listing's hidden state. Returns the new state (true =
 * hidden). Throws if not signed in. */
const toggleHidden = async (listingId: string): Promise<boolean> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const { data: existing } = await supabase
    .from(HIDDEN_LISTINGS_TABLE)
    .select('listing_id')
    .eq('user_id', user.id)
    .eq('listing_id', listingId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from(HIDDEN_LISTINGS_TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('listing_id', listingId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from(HIDDEN_LISTINGS_TABLE)
      .insert({ user_id: user.id, listing_id: listingId });
    if (error) throw error;
    return true;
  }
};

// ── Saved searches ───────────────────────────────────────────────

const SAVED_SEARCHES_TABLE = 'saved_searches';

export type NotifyCadence = 'none' | 'daily' | 'weekly';

export interface SavedSearch {
  id: string;
  name: string;
  // Opaque filter payload — the caller (Dashboard) defines the shape.
  // Kept as `Record<string, unknown>` here to avoid leaking the
  // FilterState type into this abstraction layer.
  filters: Record<string, unknown>;
  notifyCadence: NotifyCadence;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SavedSearchRow {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notify_cadence: NotifyCadence;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

const rowToSavedSearch = (r: SavedSearchRow): SavedSearch => ({
  id: r.id,
  name: r.name,
  filters: r.filters ?? {},
  notifyCadence: r.notify_cadence,
  lastNotifiedAt: r.last_notified_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const listSavedSearches = async (): Promise<SavedSearch[]> => {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(SAVED_SEARCHES_TABLE)
    .select('id, name, filters, notify_cadence, last_notified_at, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as SavedSearchRow[]).map(rowToSavedSearch);
};

const createSavedSearch = async (
  name: string,
  filters: Record<string, unknown>,
  notifyCadence: NotifyCadence = 'daily',
): Promise<SavedSearch> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name required');
  const { data, error } = await supabase
    .from(SAVED_SEARCHES_TABLE)
    .insert({
      user_id: user.id,
      name: trimmed.slice(0, 80),
      filters,
      notify_cadence: notifyCadence,
    })
    .select('id, name, filters, notify_cadence, last_notified_at, created_at, updated_at')
    .single();
  if (error || !data) throw error ?? new Error('Insert failed');
  return rowToSavedSearch(data as SavedSearchRow);
};

const updateSavedSearch = async (
  id: string,
  updates: Partial<Pick<SavedSearch, 'name' | 'filters' | 'notifyCadence'>>,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name.trim().slice(0, 80);
  if (updates.filters !== undefined) patch.filters = updates.filters;
  if (updates.notifyCadence !== undefined)
    patch.notify_cadence = updates.notifyCadence;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from(SAVED_SEARCHES_TABLE)
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
};

const deleteSavedSearch = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const { error } = await supabase
    .from(SAVED_SEARCHES_TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
};

export const api = {
  auth: {
    getUser,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    onAuthChange,
  },
  savedListings: {
    list: listSaved,
    toggle: toggleSaved,
    updateNote,
  },
  hiddenListings: {
    list: listHidden,
    toggle: toggleHidden,
  },
  ratings: {
    list: listRatings,
    set: setRating,
  },
  savedSearches: {
    list: listSavedSearches,
    create: createSavedSearch,
    update: updateSavedSearch,
    delete: deleteSavedSearch,
  },
  preferences: {
    get: getPreferences,
    upsert: upsertPreferences,
  },
  projects: {
    list: listProjects,
    create: createProject,
    update: updateProject,
    delete: deleteProject,
    addItem: addItemToProject,
    moveItem: moveItemToProject,
    removeItem: removeItemFromProject,
    listItems: listProjectItems,
    getNote: getProjectNote,
    upsertNote: upsertProjectNote,
    listFiles: listProjectFiles,
    uploadFile: uploadProjectFile,
    deleteFile: deleteProjectFile,
    getFileSignedUrl: getProjectFileSignedUrl,
  },
};

// ── Projects ─────────────────────────────────────────────────────

const PROJECTS_TABLE = 'projects';
const PROJECT_ITEMS_TABLE = 'project_items';

export type ProjectStatus =
  | 'scouting'
  | 'shortlisted'
  | 'offered'
  | 'closed'
  | 'archived';

export type ProjectItemType = 'saved_search' | 'listing' | 'note' | 'file';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Populated when the caller asks for `list({ withCounts: true })`. */
  itemCount?: number;
}

export interface ProjectItem {
  id: string;
  projectId: string;
  itemType: ProjectItemType;
  itemId: string;
  sortOrder: number;
  notes: string | null;
  addedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const rowToProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  status: r.status,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function listProjects(): Promise<Project[]> {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select('id, name, description, status, sort_order, created_at, updated_at')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as ProjectRow[]).map(rowToProject);
}

async function createProject(
  name: string,
  description: string | null = null,
  status: ProjectStatus = 'scouting',
): Promise<Project> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Project name required');
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .insert({
      user_id: user.id,
      name: trimmed.slice(0, 120),
      description,
      status,
    })
    .select('id, name, description, status, sort_order, created_at, updated_at')
    .single();
  if (error || !data) throw error ?? new Error('Insert failed');
  return rowToProject(data as ProjectRow);
}

async function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'sortOrder'>>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name.trim().slice(0, 120);
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from(PROJECTS_TABLE)
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

async function deleteProject(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const { error } = await supabase
    .from(PROJECTS_TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

async function addItemToProject(
  projectId: string,
  itemType: ProjectItemType,
  itemId: string,
  notes: string | null = null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  // Upsert on the uniqueness tuple so re-adding the same item to the
  // same project silently succeeds rather than erroring.
  const { error } = await supabase.from(PROJECT_ITEMS_TABLE).upsert(
    {
      project_id: projectId,
      user_id: user.id,
      item_type: itemType,
      item_id: itemId,
      notes,
    },
    { onConflict: 'project_id,item_type,item_id' },
  );
  if (error) throw error;
}

async function moveItemToProject(
  itemRowId: string,
  newProjectId: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const { error } = await supabase
    .from(PROJECT_ITEMS_TABLE)
    .update({ project_id: newProjectId })
    .eq('id', itemRowId)
    .eq('user_id', user.id);
  if (error) throw error;
}

async function removeItemFromProject(itemRowId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const { error } = await supabase
    .from(PROJECT_ITEMS_TABLE)
    .delete()
    .eq('id', itemRowId)
    .eq('user_id', user.id);
  if (error) throw error;
}

async function getProjectNote(projectId: string): Promise<string> {
  if (!supabase) return '';
  const user = await getUser();
  if (!user) return '';
  const { data, error } = await supabase
    .from('project_notes')
    .select('body_md')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return '';
  return (data.body_md as string) ?? '';
}

async function upsertProjectNote(projectId: string, bodyMd: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  // Find existing note (one per project for v1).
  const { data: existing } = await supabase
    .from('project_notes')
    .select('id')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('project_notes')
      .update({ body_md: bodyMd })
      .eq('id', existing.id)
      .eq('user_id', user.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('project_notes')
    .insert({ user_id: user.id, project_id: projectId, body_md: bodyMd });
  if (error) throw error;
}

// ── Project files ────────────────────────────────────────────────

export interface ProjectFile {
  id: string;
  projectId: string;
  filename: string;
  sizeBytes: number;
  contentType: string | null;
  storagePath: string;
  extractedText: string | null;
  createdAt: string;
}

const PROJECT_FILES_BUCKET = 'project-files';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('project_files')
    .select('id, project_id, filename, size_bytes, content_type, storage_path, extracted_text, created_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    filename: r.filename as string,
    sizeBytes: (r.size_bytes as number) ?? 0,
    contentType: (r.content_type as string | null) ?? null,
    storagePath: r.storage_path as string,
    extractedText: (r.extracted_text as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

async function uploadProjectFile(
  projectId: string,
  file: File,
): Promise<ProjectFile> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    );
  }

  // Storage path: {user_id}/{project_id}/{timestamp}-{sanitized_filename}
  // The user-id prefix lets storage RLS scope by ownership at the
  // path level (operator configures the matching policy in Supabase
  // dashboard — see context/PROJECT_FILES_SETUP.md).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const storagePath = `${user.id}/${projectId}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from(PROJECT_FILES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  // Insert metadata row. If this fails after the upload succeeded,
  // we have an orphan blob — operator can periodically reconcile via
  // a cleanup script. Acceptable for MVP.
  const { data, error } = await supabase
    .from('project_files')
    .insert({
      project_id: projectId,
      user_id: user.id,
      filename: file.name,
      size_bytes: file.size,
      content_type: file.type || null,
      storage_path: storagePath,
    })
    .select('id, project_id, filename, size_bytes, content_type, storage_path, extracted_text, created_at')
    .single();
  if (error || !data) {
    // Best-effort cleanup of the blob we just uploaded.
    await supabase.storage.from(PROJECT_FILES_BUCKET).remove([storagePath]);
    throw error ?? new Error('File metadata insert failed');
  }
  return {
    id: data.id as string,
    projectId: data.project_id as string,
    filename: data.filename as string,
    sizeBytes: (data.size_bytes as number) ?? 0,
    contentType: (data.content_type as string | null) ?? null,
    storagePath: data.storage_path as string,
    extractedText: (data.extracted_text as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}

async function deleteProjectFile(fileId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  // Find the storage path before deleting the metadata row.
  const { data: row } = await supabase
    .from('project_files')
    .select('storage_path')
    .eq('id', fileId)
    .eq('user_id', user.id)
    .maybeSingle();
  const { error } = await supabase
    .from('project_files')
    .delete()
    .eq('id', fileId)
    .eq('user_id', user.id);
  if (error) throw error;
  if (row?.storage_path) {
    // Best-effort blob cleanup.
    await supabase.storage
      .from(PROJECT_FILES_BUCKET)
      .remove([row.storage_path as string]);
  }
}

async function getProjectFileSignedUrl(
  storagePath: string,
  expiresIn = 60,
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from(PROJECT_FILES_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

async function listProjectItems(projectId: string): Promise<ProjectItem[]> {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from(PROJECT_ITEMS_TABLE)
    .select('id, project_id, item_type, item_id, sort_order, notes, added_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    itemType: r.item_type as ProjectItemType,
    itemId: r.item_id as string,
    sortOrder: (r.sort_order as number) ?? 0,
    notes: (r.notes as string | null) ?? null,
    addedAt: r.added_at as string,
  }));
}

// ── User preferences ─────────────────────────────────────────────

const USER_PREFERENCES_TABLE = 'user_preferences';

/**
 * Read the current user's preferences. Returns null when not
 * logged in, no row exists, or Supabase is unconfigured — caller
 * should treat absent as "onboarding not complete".
 */
async function getPreferences(): Promise<{
  preferences: Record<string, unknown>;
  completedAt: string | null;
} | null> {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .select('preferences, completed_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    preferences: (data.preferences as Record<string, unknown>) ?? {},
    completedAt: (data.completed_at as string | null) ?? null,
  };
}

/**
 * Upsert preferences. Shape is opaque to the API layer — caller
 * passes the full preferences object each time (additive merges are
 * the caller's problem; keeping the API dumb avoids stale-merge
 * bugs when schema evolves).
 *
 * Pass `completed: true` when the user finishes onboarding; stamps
 * the completed_at timestamp so we stop prompting them.
 */
async function upsertPreferences(
  preferences: Record<string, unknown>,
  { completed }: { completed?: boolean } = {},
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if (!user) throw new Error('Must be signed in');
  const payload: Record<string, unknown> = {
    user_id: user.id,
    preferences,
  };
  if (completed) {
    payload.completed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}
