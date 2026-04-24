import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Project,
  type ProjectItem,
  type ProjectItemType,
  type ProjectStatus,
} from '../lib/api';
import { useAuth } from './useAuth';

/**
 * Projects workspace hook.
 *
 * Loads the user's projects once per auth change. Exposes CRUD plus
 * item-movement helpers (add/move/remove across projects). Not wrapped
 * in a context yet — only the Projects list/detail surfaces consume it,
 * no per-card thundering-herd concern like saved_listings has.
 */
export const useProjects = () => {
  const { user, configured } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!configured || !user) {
      setProjects([]);
      return;
    }
    setLoading(true);
    try {
      setProjects(await api.projects.list());
    } finally {
      setLoading(false);
    }
  }, [configured, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (
      name: string,
      description?: string | null,
      status: ProjectStatus = 'scouting',
    ) => {
      const row = await api.projects.create(name, description ?? null, status);
      setProjects((prev) => [row, ...prev]);
      return row;
    },
    [],
  );

  const update = useCallback(
    async (
      id: string,
      updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'sortOrder'>>,
    ) => {
      await api.projects.update(id, updates);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      const prev = projects;
      setProjects((list) => list.filter((p) => p.id !== id));
      try {
        await api.projects.delete(id);
      } catch (err) {
        setProjects(prev);
        throw err;
      }
    },
    [projects],
  );

  /** Add an item to a project — handy for "Save to project" buttons on
   * property cards or saved-search rows. */
  const addItem = useCallback(
    async (
      projectId: string,
      itemType: ProjectItemType,
      itemId: string,
      notes?: string | null,
    ) => {
      await api.projects.addItem(projectId, itemType, itemId, notes ?? null);
    },
    [],
  );

  return { projects, loading, refresh, create, update, remove, addItem };
};

/**
 * Load items for one project. Separate hook because the items live
 * on the project detail view, not alongside the projects list — no
 * reason to pre-fetch every project's items when the user's only
 * looking at one.
 */
export const useProjectItems = (projectId: string | null) => {
  const { user, configured } = useAuth();
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!configured || !user || !projectId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await api.projects.listItems(projectId));
    } finally {
      setLoading(false);
    }
  }, [configured, user, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const move = useCallback(
    async (itemRowId: string, newProjectId: string) => {
      await api.projects.moveItem(itemRowId, newProjectId);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (itemRowId: string) => {
      const prev = items;
      setItems((list) => list.filter((i) => i.id !== itemRowId));
      try {
        await api.projects.removeItem(itemRowId);
      } catch (err) {
        setItems(prev);
        throw err;
      }
    },
    [items],
  );

  return { items, loading, refresh, move, remove };
};
