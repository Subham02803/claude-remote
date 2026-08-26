import type { Workspace } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Which workspace this browser is looking at, and the list to switch between.
 *
 * The choice lives in localStorage rather than in the URL: it is a property of
 * the device, not of the thing being looked at, and a session link sent from a
 * laptop to a phone should open that session either way.
 *
 * A stored id that no longer exists — the workspace was removed on another
 * device — falls back to the first one rather than showing nothing.
 */
const KEY = 'cr.workspace';

function remembered(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Private windows and blocked site data both throw here. Not remembering
    // is a fine outcome; failing to render is not.
    return null;
  }
}

function remember(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* see above */
  }
}

export interface Workspaces {
  workspaces: Workspace[];
  current: Workspace | null;
  /** True until the first listing lands, so screens can hold off on "none". */
  loading: boolean;
  select(id: string): void;
  create(name: string): Promise<void>;
  reload(): Promise<void>;
}

export function useWorkspaces(): Workspaces {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [chosen, setChosen] = useState<string | null>(remembered);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { workspaces: next } = await api.workspaces();
      setWorkspaces(next);
    } catch {
      /* the screens already say when the server is unreachable */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = workspaces.find((w) => w.id === chosen) ?? workspaces[0] ?? null;

  const select = useCallback((id: string) => {
    setChosen(id);
    remember(id);
  }, []);

  const create = useCallback(
    async (name: string) => {
      const { workspace } = await api.createWorkspace(name);
      await reload();
      select(workspace.id);
    },
    [reload, select],
  );

  return { workspaces, current, loading, select, create, reload };
}
