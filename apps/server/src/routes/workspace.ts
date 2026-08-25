import { type Project, isLive } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { audit } from '../session/audit.js';
import { readChanges } from '../session/changes.js';
import * as sessions from '../session/store.js';
import { ANSWER, sendKeys, sendText } from '../terminal/keys.js';
import { hasSession, sessionName } from '../terminal/tmux.js';

/** Best guess at which device this is, for UC-8's "started from your phone". */
function deviceOf(req: FastifyRequest): string {
  const ua = String(req.headers['user-agent'] ?? '');
  if (/iPhone|Android|Mobile/i.test(ua)) return 'your phone';
  if (/iPad|Tablet/i.test(ua)) return 'your tablet';
  return 'this browser';
}

export function registerWorkspaceRoutes(app: FastifyInstance, config: Config, db: Database): void {
  app.get('/api/projects', async (): Promise<{ projects: Project[] }> => {
    const live = await sessions.list(db, config);
    return {
      projects: config.projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        sessions: live.filter((s) => s.projectId === p.id && isLive(s)).length,
      })),
    };
  });

  app.get('/api/sessions', async () => ({ sessions: await sessions.list(db, config) }));

  const createBody = z.object({
    projectId: z.string().min(1),
    title: z.string().max(120).optional(),
  });

  app.post('/api/sessions', async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'A projectId is required.' });
    }
    try {
      const session = await sessions.create(db, config, {
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        startedFrom: deviceOf(req),
      });
      req.log.info({ id: session.id, project: session.projectId }, 'session started');
      return reply.code(201).send({ session });
    } catch (err) {
      if (err instanceof sessions.NoSuchProject) {
        return reply.code(404).send({ error: 'no_such_project', message: err.message });
      }
      req.log.error({ err }, 'could not start a session');
      return reply.code(500).send({
        error: 'start_failed',
        message: 'Could not start the session. Is tmux installed?',
      });
    }
  });

  const decisionBody = z.object({ answer: z.enum(['approve', 'deny']) });

  /**
   * Answering the question a session is blocked on.
   *
   * Refuses unless an ask is genuinely open. That check is the difference
   * between answering a question and typing a stray "1" into whatever the
   * terminal happens to be showing.
   */
  app.post<{ Params: { id: string } }>('/api/sessions/:id/decision', async (req, reply) => {
    const parsed = decisionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'answer must be "approve" or "deny".' });
    }
    const open = db
      .prepare(
        'SELECT id, tool, detail FROM asks WHERE session_id = ? AND answered_at IS NULL ORDER BY id DESC LIMIT 1',
      )
      .get(req.params.id) as { id: number; tool: string; detail: string } | undefined;

    if (!open) {
      return reply.code(409).send({
        error: 'nothing_to_answer',
        message: 'That session is not waiting on anything.',
      });
    }

    try {
      await sendKeys(req.params.id, [...ANSWER[parsed.data.answer]]);
    } catch (err) {
      req.log.error({ err, id: req.params.id }, 'could not deliver the answer');
      return reply
        .code(502)
        .send({ error: 'send_failed', message: 'Could not reach that session.' });
    }

    db.prepare(
      "UPDATE asks SET answer = ?, answered_at = datetime('now'), answered_from = ? WHERE id = ?",
    ).run(parsed.data.answer, deviceOf(req), open.id);
    db.prepare(
      "UPDATE sessions SET status = 'working', status_at = datetime('now'), doing = ? WHERE id = ?",
    ).run(
      parsed.data.answer === 'approve' ? `approved ${open.tool}` : 'taking another route',
      req.params.id,
    );

    audit(db, {
      event: `ask.${parsed.data.answer}`,
      actor: deviceOf(req),
      detail: { session: req.params.id, tool: open.tool, input: open.detail },
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    });
    req.log.info({ id: req.params.id, answer: parsed.data.answer, tool: open.tool }, 'answered');
    return { ok: true };
  });

  const promptBody = z.object({ text: z.string().min(1).max(8000) });

  /**
   * Sending a prompt without using the terminal keyboard.
   *
   * Scope §5.1 asks for reduced typing on a phone; a full-width text box beats
   * a virtual keyboard inside an xterm every time. The text goes in, then a
   * separate Enter — Claude Code's input does not reliably accept both in one
   * `send-keys`, which is a papercut worth absorbing here rather than in the UI.
   */
  app.post<{ Params: { id: string } }>('/api/sessions/:id/prompt', async (req, reply) => {
    const parsed = promptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'A prompt is required.' });
    }
    const target = sessions.get(db, req.params.id);
    if (!target) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    if (target.ended_at || !(await hasSession(sessionName(req.params.id)))) {
      return reply
        .code(409)
        .send({ error: 'session_ended', message: 'That session has already ended.' });
    }
    try {
      await sendText(req.params.id, parsed.data.text);
    } catch (err) {
      req.log.error({ err }, 'could not deliver the prompt');
      return reply
        .code(502)
        .send({ error: 'send_failed', message: 'Could not reach that session.' });
    }
    req.log.info({ id: req.params.id }, 'prompt sent');
    return { ok: true };
  });

  /**
   * Interrupting a run.
   *
   * Ctrl-C, not kill: this stops what Claude is doing while leaving the session
   * there to carry on with. Ending it for real is DELETE.
   */
  app.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    // A row surviving is not the same as the session running: rows are kept so
    // finished sessions can still be read back. tmux is the source of truth,
    // and without this check send-keys fails against nothing and 500s.
    if (row.ended_at || !(await hasSession(sessionName(req.params.id)))) {
      return reply
        .code(409)
        .send({ error: 'session_ended', message: 'That session has already ended.' });
    }
    try {
      await sendKeys(req.params.id, ['C-c']);
    } catch (err) {
      req.log.error({ err, id: req.params.id }, 'could not interrupt');
      return reply
        .code(502)
        .send({ error: 'stop_failed', message: 'Could not reach that session.' });
    }
    db.prepare(
      "UPDATE sessions SET doing = 'stopped by you', status_at = datetime('now') WHERE id = ?",
    ).run(req.params.id);
    audit(db, { event: 'session.stop', actor: deviceOf(req), detail: { session: req.params.id } });
    return { ok: true };
  });

  /** What this session changed, read from Claude Code's own transcript. */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/changes', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    return { files: readChanges(db, req.params.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    await sessions.end(db, req.params.id);
    req.log.info({ id: req.params.id }, 'session ended');
    return { ok: true };
  });
}
