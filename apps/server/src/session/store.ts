import { randomBytes } from 'node:crypto';
import type { Session } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { Config, ProjectConfig } from '../config.js';
import { writeHookSettings } from '../hooks/settings.js';
import type { Log } from '../logger.js';
import {
  killSession,
  listSessions as listTmux,
  newSession,
  sessionName,
} from '../terminal/tmux.js';

interface Row {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  started_from: string | null;
  ended_at: string | null;
  claude_session_id: string | null;
  status: string;
  status_at: string | null;
  doing: string | null;
}

/** Short, unambiguous, and safe inside a tmux session name. */
function newId(): string {
  return randomBytes(5).toString('hex');
}

function projectOf(config: Config, id: string): ProjectConfig | undefined {
  return config.projects.find((p) => p.id === id);
}

/**
 * Brings the database in line with tmux.
 *
 * tmux decides what exists — it is the thing actually running the work, and it
 * survives this process. Anything here that tmux does not have is over;
 * anything tmux has that we do not know about is adopted rather than ignored,
 * because a session you cannot see is worse than one with a dull name.
 *
 * Run at boot and before every listing, so the two can never drift far enough
 * to matter.
 */
export async function reconcile(db: Database, config: Config, logger?: Log): Promise<void> {
  const live = new Set((await listTmux()).map((s) => s.name));
  const rows = db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL').all() as Row[];

  let ended = 0;
  for (const row of rows) {
    if (!live.has(sessionName(row.id))) {
      db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      ended += 1;
    }
  }

  const known = new Set(rows.map((r) => sessionName(r.id)));
  let adopted = 0;
  for (const name of live) {
    if (known.has(name)) continue;
    const id = name.slice('cr-'.length);
    // An orphan is still real work. Park it on the first project rather than
    // pretending it is not there.
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare('UPDATE sessions SET ended_at = NULL WHERE id = ?').run(id);
    } else {
      db.prepare(
        'INSERT INTO sessions (id, project_id, title, started_from) VALUES (?, ?, ?, ?)',
      ).run(id, config.projects[0]?.id ?? 'default', `adopted ${id}`, 'the machine');
    }
    adopted += 1;
  }

  if (logger && (ended || adopted))
    logger.info({ ended, adopted }, 'reconciled sessions with tmux');
}

/** Every session, live ones first. Reconciles before answering. */
export async function list(db: Database, config: Config): Promise<Session[]> {
  await reconcile(db, config);
  const attached = new Map((await listTmux()).map((s) => [s.name, s.attached]));
  const openAsks = new Map(
    (
      db
        .prepare(
          'SELECT session_id, tool, detail, asked_at FROM asks WHERE answered_at IS NULL ORDER BY id DESC',
        )
        .all() as { session_id: string; tool: string; detail: string; asked_at: string }[]
    ).map((a) => [a.session_id, { tool: a.tool, detail: a.detail, askedAt: a.asked_at }]),
  );
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY ended_at IS NOT NULL, created_at DESC')
    .all() as Row[];

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: projectOf(config, r.project_id)?.name ?? r.project_id,
    title: r.title,
    // tmux having lost the session outranks whatever the last hook said: the
    // process is gone, so "working" would be a lie.
    status: (r.ended_at ? 'ended' : (r.status as Session['status'])) ?? 'starting',
    createdAt: r.created_at,
    startedFrom: r.started_from,
    attached: attached.get(sessionName(r.id)) ?? false,
    doing: r.ended_at ? null : r.doing,
    statusAt: r.status_at,
    // Only while genuinely blocked — never a stale button pointing at a prompt
    // that has moved on.
    ask: r.ended_at ? null : (openAsks.get(r.id) ?? null),
  }));
}

export function get(db: Database, id: string): Row | null {
  return (db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined) ?? null;
}

export class NoSuchProject extends Error {}

/**
 * Starts a session: a row, then a tmux session running the command in the
 * project's folder. The row first, so a tmux session can never exist without
 * something to explain it.
 */
export async function create(
  db: Database,
  config: Config,
  input: { projectId: string; title?: string; startedFrom?: string },
): Promise<Session> {
  const project = projectOf(config, input.projectId);
  if (!project) throw new NoSuchProject(`No project with id "${input.projectId}".`);

  const id = newId();
  const title = (input.title ?? '').trim() || `session ${id}`;
  db.prepare('INSERT INTO sessions (id, project_id, title, started_from) VALUES (?, ?, ?, ?)').run(
    id,
    project.id,
    title,
    input.startedFrom ?? null,
  );

  // Each session gets its own settings file so its hooks carry its id. Only
  // added for `claude` itself — tests run `bash`, which would choke on the flag.
  let command = config.terminalCommand;
  if (/(^|\/)claude(\s|$)/.test(command)) {
    const settings = writeHookSettings(config, id);
    command = `${command} --settings ${JSON.stringify(settings)}`;
  }

  try {
    await newSession({ name: sessionName(id), cwd: project.path, command });
  } catch (err) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    throw err;
  }

  return {
    id,
    projectId: project.id,
    projectName: project.name,
    title,
    status: 'starting',
    createdAt: new Date().toISOString(),
    startedFrom: input.startedFrom ?? null,
    attached: false,
    doing: null,
    statusAt: null,
    ask: null,
  };
}

/** Ends a session for real. This is the one thing that stops the work. */
export async function end(db: Database, id: string): Promise<void> {
  await killSession(sessionName(id));
  db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(id);
}
