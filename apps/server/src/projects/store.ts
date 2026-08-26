import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { Project, Workspace } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { Config } from '../config.js';
import { repoRoot } from '../config.js';
import type { Log } from '../logger.js';
import { homeRelative, resolveInHome } from './browse.js';

/**
 * Workspaces and the projects inside them.
 *
 * This is what `config.projects` used to be. The rule it enforced is unchanged
 * — a session may only start in a folder that was named on purpose — but the
 * list is now something a running server can be told to add to, rather than an
 * environment variable that needed a restart.
 */

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  path: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

/** Raised when a name reduces to nothing usable, or a folder is not one. */
export class NotUsable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotUsable';
  }
}

/** Raised when a project is added to a workspace that already has that folder. */
export class AlreadyThere extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyThere';
  }
}

export class NoSuchWorkspace extends Error {}

/** Lowercased, alphanumeric and dashes. Safe in a URL and readable in one. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/**
 * A slug nothing else in `table` is using.
 *
 * Ids are readable rather than random because they appear in URLs and in the
 * session rows that outlive the project — `seller-stock` explains itself where
 * `a41f0c` does not.
 */
function freeId(db: Database, table: 'workspaces' | 'projects', name: string): string {
  const base = slug(name);
  if (!base) throw new NotUsable(`"${name}" has no letters or numbers in it.`);
  const taken = (id: string) =>
    db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  throw new NotUsable(`Too many things are already called "${base}".`);
}

/* -------------------------------- reading -------------------------------- */

/** One project by id, or null. The only way a route turns an id into a path. */
export function getProject(db: Database, id: string): ProjectRow | null {
  return (
    (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined) ?? null
  );
}

/** Every project, in every workspace. */
export function allProjects(db: Database): ProjectRow[] {
  return db
    .prepare('SELECT * FROM projects ORDER BY workspace_id, name COLLATE NOCASE')
    .all() as ProjectRow[];
}

/** The absolute path of a project, checked to still be a directory. */
export function projectPath(db: Database, id: string): string | null {
  const row = getProject(db, id);
  if (!row) return null;
  // Stored months ago; the folder may have been renamed or deleted since.
  if (!existsSync(row.path) || !statSync(row.path).isDirectory()) return null;
  return row.path;
}

/**
 * Workspaces with their projects, each project carrying its live session count.
 *
 * The counts are passed in rather than read here so this stays a query about
 * folders — sessions are the session store's business.
 */
export function listWorkspaces(db: Database, liveSessions: Map<string, number>): Workspace[] {
  const workspaces = db
    .prepare('SELECT * FROM workspaces ORDER BY created_at')
    .all() as WorkspaceRow[];
  const projects = allProjects(db);
  return workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    createdAt: w.created_at,
    projects: projects
      .filter((p) => p.workspace_id === w.id)
      .map((p) => ({
        id: p.id,
        workspaceId: p.workspace_id,
        name: p.name,
        path: p.path,
        sessions: liveSessions.get(p.id) ?? 0,
      })),
  }));
}

/** Every project as the API shape, flattened across workspaces. */
export function listProjects(db: Database, liveSessions: Map<string, number>): Project[] {
  return allProjects(db).map((p) => ({
    id: p.id,
    workspaceId: p.workspace_id,
    name: p.name,
    path: p.path,
    sessions: liveSessions.get(p.id) ?? 0,
  }));
}

/* -------------------------------- writing -------------------------------- */

export function createWorkspace(db: Database, name: string): Workspace {
  const trimmed = name.trim();
  if (!trimmed) throw new NotUsable('A workspace needs a name.');
  const id = freeId(db, 'workspaces', trimmed);
  db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(id, trimmed);
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
  return { id: row.id, name: row.name, createdAt: row.created_at, projects: [] };
}

export function renameWorkspace(db: Database, id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new NotUsable('A workspace needs a name.');
  const changed = db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(trimmed, id);
  if (changed.changes === 0) throw new NoSuchWorkspace(`No workspace with id "${id}".`);
}

/**
 * Removes a workspace and the projects in it.
 *
 * Sessions started in those projects are left alone — they are history, and the
 * row that records what was done survives the folder being un-named.
 */
export function deleteWorkspace(db: Database, id: string): void {
  const changed = db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  if (changed.changes === 0) throw new NoSuchWorkspace(`No workspace with id "${id}".`);
}

/**
 * Adds a folder to a workspace.
 *
 * `relative` is a path under the home directory, exactly as the picker returned
 * it. Resolving it here rather than trusting an absolute path from the browser
 * is the whole containment story: see `browse.ts`.
 */
export function addProject(
  db: Database,
  workspaceId: string,
  relative: string,
  name?: string,
): Project {
  const exists = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId);
  if (!exists) throw new NoSuchWorkspace(`No workspace with id "${workspaceId}".`);

  // Throws OutsideHome for anything that resolves out of the home directory,
  // and ENOENT for a folder that is not there.
  const path = resolveInHome(relative);
  if (!statSync(path).isDirectory()) {
    throw new NotUsable('A project has to be a folder.');
  }

  const clash = db
    .prepare('SELECT name FROM projects WHERE workspace_id = ? AND path = ?')
    .get(workspaceId, path) as { name: string } | undefined;
  if (clash) throw new AlreadyThere(`That folder is already in this workspace as "${clash.name}".`);

  const label = (name ?? '').trim() || basename(path);
  const id = freeId(db, 'projects', label);
  db.prepare('INSERT INTO projects (id, workspace_id, name, path) VALUES (?, ?, ?, ?)').run(
    id,
    workspaceId,
    label,
    path,
  );
  return { id, workspaceId, name: label, path, sessions: 0 };
}

/** Takes a project out of its workspace. Sessions started in it are kept. */
export function removeProject(db: Database, id: string): boolean {
  return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

/* -------------------------------- seeding -------------------------------- */

/**
 * Makes sure there is somewhere to start a session on first boot.
 *
 * Two things happen here, once each, and only when the table is empty:
 *
 * 1. A default workspace is created, so the picker is never empty.
 * 2. A legacy `PROJECTS=name=path` environment variable, if one is still set,
 *    is imported into it — ids and all, so sessions started before the move
 *    still point at the project they were started in. This is the one place
 *    that variable is still read, and it is read once.
 *
 * With neither, the repo root becomes the only project, which is what an empty
 * `PROJECTS` used to mean.
 */
export function seedWorkspaces(
  db: Database,
  config: Config,
  logger: Log,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const count = db.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number };
  if (count.n > 0) return;

  const workspace = createWorkspace(db, 'My projects');

  const legacy = (env.PROJECTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let imported = 0;
  for (const entry of legacy) {
    const at = entry.indexOf('=');
    if (at < 1) continue;
    const name = entry.slice(0, at).trim();
    const raw = entry.slice(at + 1).trim();
    let path: string;
    try {
      path = realpathSync(raw.replace(/^~(?=$|[/\\])/, config.home));
    } catch {
      logger.warn({ entry }, 'skipped a PROJECTS entry: that folder is not there');
      continue;
    }
    // Keeping the old id is the point of importing at all: session rows written
    // before this migration carry it.
    const id = slug(name) || `project-${imported + 1}`;
    if (db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) continue;
    db.prepare('INSERT INTO projects (id, workspace_id, name, path) VALUES (?, ?, ?, ?)').run(
      id,
      workspace.id,
      name,
      path,
    );
    imported += 1;
  }

  if (imported > 0) {
    logger.info(
      { imported },
      'imported projects from PROJECTS into a workspace — you can delete that line from .env now',
    );
    return;
  }

  // No legacy list: the repo root, under the id an empty PROJECTS used to give
  // it, so sessions started that way still resolve.
  const root = realpathSync(repoRoot);
  db.prepare('INSERT INTO projects (id, workspace_id, name, path) VALUES (?, ?, ?, ?)').run(
    'default',
    workspace.id,
    basename(root),
    root,
  );
  logger.info({ path: root }, 'created a default workspace holding this repo');
}

/** Which projects a listing should mark as already added. */
export function addedPaths(db: Database): Set<string> {
  return new Set(
    allProjects(db)
      .map((p) => homeRelative(p.path))
      .filter((p) => p !== null),
  );
}
