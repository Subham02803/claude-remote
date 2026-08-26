import { isLive } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { OutsideHome, listHomeDir } from '../projects/browse.js';
import {
  AlreadyThere,
  NoSuchWorkspace,
  NotUsable,
  addProject,
  addedPaths,
  createWorkspace,
  deleteWorkspace,
  getProject,
  listWorkspaces,
  removeProject,
  renameWorkspace,
} from '../projects/store.js';
import { audit } from '../session/audit.js';
import * as sessions from '../session/store.js';

/**
 * Workspaces, the projects in them, and the folder picker that fills them.
 *
 * These used to be an environment variable. Moving them behind an API is the
 * only real change; the guarantee is the same one the variable gave — a session
 * can start only in a folder someone named on purpose — and it is now enforced
 * at the moment a folder is named rather than at boot.
 */

/** Live sessions per project id, for the counts on every project card. */
async function sessionCounts(db: Database, config: Config): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const s of await sessions.list(db, config)) {
    if (isLive(s)) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
  }
  return counts;
}

export function registerWorkspaceAdminRoutes(
  app: FastifyInstance,
  config: Config,
  db: Database,
): void {
  app.get('/api/workspaces', async () => ({
    workspaces: listWorkspaces(db, await sessionCounts(db, config)),
  }));

  const nameBody = z.object({ name: z.string().min(1).max(60) });

  app.post('/api/workspaces', async (req, reply) => {
    const parsed = nameBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'A workspace needs a name of 1–60 characters.' });
    }
    try {
      const workspace = createWorkspace(db, parsed.data.name);
      audit(db, { event: 'workspace.create', detail: { id: workspace.id, name: workspace.name } });
      req.log.info({ id: workspace.id }, 'workspace created');
      return reply.code(201).send({ workspace });
    } catch (err) {
      if (err instanceof NotUsable) {
        return reply.code(400).send({ error: 'bad_name', message: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    const parsed = nameBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'A workspace needs a name of 1–60 characters.' });
    }
    try {
      renameWorkspace(db, req.params.id, parsed.data.name);
      return { ok: true };
    } catch (err) {
      if (err instanceof NoSuchWorkspace) {
        return reply.code(404).send({ error: 'no_such_workspace', message: err.message });
      }
      if (err instanceof NotUsable) {
        return reply.code(400).send({ error: 'bad_name', message: err.message });
      }
      throw err;
    }
  });

  /**
   * Removing a workspace, and with it the projects inside.
   *
   * Refused while anything in it is still running. Un-naming a folder out from
   * under a live session would leave a terminal open on a project the server no
   * longer knows about — ending the work is a separate, deliberate act.
   */
  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    const counts = await sessionCounts(db, config);
    const workspace = listWorkspaces(db, counts).find((w) => w.id === req.params.id);
    if (!workspace) {
      return reply.code(404).send({ error: 'no_such_workspace', message: 'No such workspace.' });
    }
    const running = workspace.projects.reduce((n, p) => n + p.sessions, 0);
    if (running > 0) {
      return reply.code(409).send({
        error: 'sessions_running',
        message: `${running} session${running === 1 ? ' is' : 's are'} still running in this workspace. End ${running === 1 ? 'it' : 'them'} first.`,
      });
    }
    deleteWorkspace(db, req.params.id);
    audit(db, { event: 'workspace.delete', detail: { id: req.params.id } });
    req.log.info({ id: req.params.id }, 'workspace removed');
    return { ok: true };
  });

  const addBody = z.object({
    /** Home-relative, forward slashes, exactly as the picker returned it. */
    path: z.string().max(4096),
    name: z.string().max(60).optional(),
  });

  app.post<{ Params: { id: string } }>('/api/workspaces/:id/projects', async (req, reply) => {
    const parsed = addBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'A folder is required.' });
    }
    try {
      const project = addProject(db, req.params.id, parsed.data.path, parsed.data.name);
      audit(db, {
        event: 'project.add',
        detail: { workspace: req.params.id, id: project.id, path: project.path },
      });
      req.log.info({ id: project.id, path: project.path }, 'project added');
      return reply.code(201).send({ project });
    } catch (err) {
      if (err instanceof OutsideHome) {
        req.log.warn({ path: parsed.data.path }, 'refused a folder outside home');
        return reply.code(403).send({ error: 'outside_home', message: err.message });
      }
      if (err instanceof NoSuchWorkspace) {
        return reply.code(404).send({ error: 'no_such_workspace', message: err.message });
      }
      if (err instanceof AlreadyThere) {
        return reply.code(409).send({ error: 'already_there', message: err.message });
      }
      if (err instanceof NotUsable) {
        return reply.code(400).send({ error: 'bad_folder', message: err.message });
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply
          .code(404)
          .send({ error: 'no_such_folder', message: 'That folder is not there any more.' });
      }
      throw err;
    }
  });

  /** Taking a project out of a workspace. Sessions it started are kept. */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const project = getProject(db, req.params.id);
    if (!project) {
      return reply.code(404).send({ error: 'no_such_project', message: 'No such project.' });
    }
    const running = (await sessionCounts(db, config)).get(req.params.id) ?? 0;
    if (running > 0) {
      return reply.code(409).send({
        error: 'sessions_running',
        message: `${running} session${running === 1 ? ' is' : 's are'} still running in this project. End ${running === 1 ? 'it' : 'them'} first.`,
      });
    }
    removeProject(db, req.params.id);
    audit(db, { event: 'project.remove', detail: { id: req.params.id, path: project.path } });
    req.log.info({ id: req.params.id }, 'project removed');
    return { ok: true };
  });

  const folderQuery = z.object({ path: z.string().max(4096).optional() });

  /**
   * The folder picker.
   *
   * Rooted at the home directory and nothing above it, so this endpoint cannot
   * be turned into a way to read the disk. A refused path answers the same way
   * whether it escaped home or simply is not there, so it is not a probe for
   * what exists elsewhere either.
   */
  app.get('/api/folders', async (req, reply) => {
    const parsed = folderQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'That path is not usable.' });
    }
    try {
      return listHomeDir(parsed.data.path ?? '', addedPaths(db));
    } catch (err) {
      if (err instanceof OutsideHome) {
        req.log.warn({ path: parsed.data.path }, 'refused a folder outside home');
        return reply.code(403).send({ error: 'outside_home', message: err.message });
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return reply
          .code(404)
          .send({ error: 'no_such_folder', message: 'That folder is not there.' });
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return reply
          .code(403)
          .send({ error: 'not_allowed', message: 'That folder cannot be opened.' });
      }
      req.log.error({ err }, 'could not list a folder');
      return reply.code(500).send({ error: 'list_failed', message: 'Could not read that folder.' });
    }
  });
}
