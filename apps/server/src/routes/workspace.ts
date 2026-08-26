import { type Project, type SessionStatus, isLive, isStoppable } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { getProject, listProjects } from '../projects/store.js';
import { readAgents } from '../session/agents.js';
import { audit } from '../session/audit.js';
import { readChanges, readEdits } from '../session/changes.js';
import { parseChoice } from '../session/choices.js';
import {
  NotPreviewable,
  OutsideProject,
  listProjectDir,
  readProjectFile,
} from '../session/files.js';
import * as sessions from '../session/store.js';
import { readTranscript } from '../session/transcript.js';
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  NotAnImage,
  composePrompt,
  readUpload,
  saveUpload,
  uploadPath,
} from '../session/uploads.js';
import { ANSWER, choose, sendKeys, sendText } from '../terminal/keys.js';
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
    const counts = new Map<string, number>();
    for (const s of live) {
      if (isLive(s)) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
    }
    return { projects: listProjects(db, counts) };
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
      if (err instanceof sessions.ProjectGone) {
        return reply.code(409).send({ error: 'project_gone', message: err.message });
      }
      req.log.error({ err }, 'could not start a session');
      return reply.code(500).send({
        error: 'start_failed',
        message: 'Could not start the session. Is tmux installed?',
      });
    }
  });

  const decisionBody = z.object({
    answer: z.enum(['approve', 'deny', 'choose']),
    /** Which option, 1-based, when the answer is 'choose'. */
    option: z.number().int().min(1).max(9).optional(),
  });

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
        .send({ error: 'bad_request', message: 'answer must be "approve", "deny" or "choose".' });
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

    /**
     * Picking an option is checked against the question that is actually open.
     *
     * Same reason the whole endpoint refuses when nothing is waiting: a digit
     * sent at the wrong moment is not a no-op, it is a keystroke typed into
     * whatever the terminal is showing. "Option 3" is only ever sent when
     * there is an open question with a third option.
     */
    const choice = parseChoice(open.tool, open.detail);
    let chosen: { n: number; label: string } | null = null;

    if (parsed.data.answer === 'choose') {
      const n = parsed.data.option;
      const option = n ? choice?.options.find((o) => o.n === n) : undefined;
      if (!choice || !option) {
        return reply.code(409).send({
          error: 'no_such_option',
          message: 'That is not one of the options being asked about.',
        });
      }
      // Several answers are picked with the spacebar and confirmed with Enter,
      // which one keystroke cannot express. Guessing at it from here would
      // submit an answer nobody gave, so it stays a job for the terminal.
      if (choice.multiSelect) {
        return reply.code(409).send({
          error: 'multi_select',
          message: 'This one takes several answers, so it has to be answered in the terminal.',
        });
      }
      chosen = { n: option.n, label: option.label };
    }

    try {
      await sendKeys(
        req.params.id,
        chosen ? choose(chosen.n) : [...ANSWER[parsed.data.answer as 'approve' | 'deny']],
      );
    } catch (err) {
      req.log.error({ err, id: req.params.id }, 'could not deliver the answer');
      return reply
        .code(502)
        .send({ error: 'send_failed', message: 'Could not reach that session.' });
    }

    // What was answered, in the words it was answered with. A row saying
    // 'approved' where someone picked "leave it failing" is a record of
    // something that did not happen.
    const recorded = chosen ? `chose ${chosen.n}` : parsed.data.answer;
    const doing = chosen
      ? `chose "${chosen.label}"`
      : parsed.data.answer === 'approve'
        ? `approved ${open.tool}`
        : 'taking another route';

    db.prepare(
      "UPDATE asks SET answer = ?, answered_at = datetime('now'), answered_from = ? WHERE id = ?",
    ).run(recorded, deviceOf(req), open.id);
    db.prepare(
      "UPDATE sessions SET status = 'working', status_at = datetime('now'), doing = ? WHERE id = ?",
    ).run(doing, req.params.id);

    audit(db, {
      event: `ask.${recorded}`,
      actor: deviceOf(req),
      detail: {
        session: req.params.id,
        tool: open.tool,
        input: open.detail,
        chose: chosen?.label,
      },
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    });
    req.log.info({ id: req.params.id, answer: recorded, tool: open.tool }, 'answered');
    return { ok: true };
  });

  const promptBody = z
    .object({
      text: z.string().max(8000).default(''),
      /** Names from `/uploads`, never paths — see the upload route below. */
      images: z.array(z.string().max(64)).max(MAX_IMAGES).default([]),
    })
    .refine((b) => b.text.trim() !== '' || b.images.length > 0, {
      message: 'A prompt or an image is required.',
    });

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
    const project = getProject(db, target.project_id);
    if (!project) {
      return reply.code(404).send({ error: 'no_such_project', message: 'No such project.' });
    }
    if (target.ended_at || !(await hasSession(sessionName(req.params.id)))) {
      return reply
        .code(409)
        .send({ error: 'session_ended', message: 'That session has already ended.' });
    }

    // Names, resolved here. The client never sends a path: a path in a request
    // body is a path this server would type into a live shell session, and
    // "read /Users/you/.ssh/id_rsa" is a perfectly well-formed prompt.
    const paths: string[] = [];
    for (const name of parsed.data.images) {
      const path = uploadPath(project.path, req.params.id, name);
      if (!path) {
        return reply
          .code(404)
          .send({ error: 'no_such_image', message: 'That image is not there any more.' });
      }
      paths.push(path);
    }

    try {
      await sendText(req.params.id, composePrompt(parsed.data.text, paths));
    } catch (err) {
      req.log.error({ err }, 'could not deliver the prompt');
      return reply
        .code(502)
        .send({ error: 'send_failed', message: 'Could not reach that session.' });
    }
    req.log.info({ id: req.params.id, images: paths.length }, 'prompt sent');
    return { ok: true };
  });

  /**
   * Taking an image from a browser.
   *
   * Raw bytes, one image per request, typed by signature rather than by the
   * header that carried them — `session/uploads.ts` has the reasoning for all
   * three, and for why the file lands inside the project.
   *
   * The write happens before the prompt does, so an upload that fails costs a
   * retry rather than half a sentence typed into a live session.
   */
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/uploads',
    { bodyLimit: MAX_IMAGE_BYTES },
    async (req, reply) => {
      const row = sessions.get(db, req.params.id);
      if (!row) {
        return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
      }
      const project = getProject(db, row.project_id);
      if (!project) {
        return reply.code(404).send({ error: 'no_such_project', message: 'No such project.' });
      }
      // Uploading into a session nobody is running just leaves litter in a
      // project: there is no prompt coming that could use it.
      if (row.ended_at || !(await hasSession(sessionName(req.params.id)))) {
        return reply
          .code(409)
          .send({ error: 'session_ended', message: 'That session has already ended.' });
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.code(400).send({ error: 'bad_request', message: 'No image was sent.' });
      }
      try {
        const stored = saveUpload(project.path, req.params.id, body);
        req.log.info({ id: req.params.id, name: stored.name, bytes: stored.bytes }, 'image saved');
        return reply.code(201).send({ upload: stored });
      } catch (err) {
        if (err instanceof NotAnImage) {
          return reply.code(415).send({ error: 'not_an_image', message: err.message });
        }
        req.log.error({ err, id: req.params.id }, 'could not save an image');
        return reply
          .code(500)
          .send({ error: 'upload_failed', message: 'Could not save that image.' });
      }
    },
  );

  /**
   * One of those images back, so the chat can show the picture.
   *
   * Only names this server minted are readable, which is what makes the lookup
   * safe: the shape has no separator in it, so there is nothing to traverse.
   * `nosniff` for the same reason the file endpoint has it — nothing served
   * from a project should ever be a document a browser decides to render.
   */
  app.get<{ Params: { id: string; name: string } }>(
    '/api/sessions/:id/uploads/:name',
    async (req, reply) => {
      const row = sessions.get(db, req.params.id);
      const project = row && getProject(db, row.project_id);
      if (!row || !project) {
        return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
      }
      const found = readUpload(project.path, req.params.id, req.params.name);
      if (!found) {
        return reply.code(404).send({ error: 'no_such_image', message: 'No such image.' });
      }
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      return reply.type(found.mime).send(found.bytes);
    },
  );

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
    // Nothing running means nothing to interrupt, and the interrupt is not a
    // no-op: Ctrl-C at an idle Claude Code prompt clears the text sitting in
    // its input. Refusing is the difference between a button that does nothing
    // and a button that quietly deletes what you were about to send.
    const status = (row.ended_at ? 'ended' : (row.status as SessionStatus)) ?? 'starting';
    if (!isStoppable({ status })) {
      return reply.code(409).send({
        error: 'not_working',
        message: 'That session is not doing anything right now.',
      });
    }
    try {
      await sendKeys(req.params.id, ['C-c']);
    } catch (err) {
      req.log.error({ err, id: req.params.id }, 'could not interrupt');
      return reply
        .code(502)
        .send({ error: 'stop_failed', message: 'Could not reach that session.' });
    }
    // Set the status here rather than waiting for a hook to say so. Claude
    // Code fires `Stop` when a turn *finishes*; an interrupted turn never
    // does, so a session stopped this way would otherwise read as working for
    // as long as it stayed open. We caused this state, so we can record it.
    db.prepare(
      "UPDATE sessions SET status = 'done', doing = 'stopped by you', status_at = datetime('now') WHERE id = ?",
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

  /**
   * The conversation itself, from Claude Code's transcript.
   *
   * Not from the terminal. tmux holds a fixed number of lines and a TUI
   * repaints over itself, so the terminal can never show the start of a long
   * conversation — the transcript always can.
   */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/transcript', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    return readTranscript(db, config, req.params.id);
  });

  /** Who is working on this session — the main agent and its subagents. */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/agents', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    return { agents: readAgents(db, req.params.id) };
  });

  /**
   * What this session changed in one file — the edits themselves, not the file.
   *
   * Kept separate from the file endpoint on purpose: they answer different
   * questions. This one is "what did the agent do"; `/file` is "what does this
   * look like now". Conflating them is what made Changes show whole files.
   */
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/sessions/:id/edits',
    async (req, reply) => {
      const row = sessions.get(db, req.params.id);
      if (!row) {
        return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
      }
      const path = req.query.path;
      if (!path) {
        return reply.code(400).send({ error: 'bad_request', message: 'A path is required.' });
      }
      return { edits: readEdits(db, req.params.id, path) };
    },
  );

  const fileQuery = z.object({ path: z.string().min(1).max(4096) });
  const treeQuery = z.object({ path: z.string().max(4096).optional() });

  /**
   * Browsing a project's files, for the Preview tab.
   *
   * Same containment as `/file`, with one difference: the root is a legal
   * answer here, because browsing has to start somewhere.
   */
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/projects/:id/tree',
    async (req, reply) => {
      const project = getProject(db, req.params.id);
      if (!project) {
        return reply.code(404).send({ error: 'no_such_project', message: 'No such project.' });
      }
      const parsed = treeQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'That path is not usable.' });
      }
      try {
        return listProjectDir(project.path, parsed.data.path ?? '');
      } catch (err) {
        if (err instanceof OutsideProject) {
          req.log.warn({ project: project.id, path: parsed.data.path }, 'refused a path');
          return reply.code(403).send({ error: 'outside_project', message: err.message });
        }
        if (err instanceof NotPreviewable) {
          return reply.code(415).send({ error: 'not_a_directory', message: err.message });
        }
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply
            .code(404)
            .send({ error: 'no_such_dir', message: 'That folder is not there any more.' });
        }
        req.log.error({ err }, 'could not list a directory');
        return reply
          .code(500)
          .send({ error: 'list_failed', message: 'Could not read that folder.' });
      }
    },
  );

  /**
   * One file from a declared project, as text, for previewing.
   *
   * Scoped to a project rather than to a path because that is what makes the
   * containment check answerable — see `session/files.ts`. Three deliberate
   * choices about how it replies:
   *
   * - Always JSON, never `text/html`. A prototype this endpoint returns must
   *   never be something a browser can be talked into rendering top-level.
   * - `nosniff`, so the above cannot be undone by content sniffing.
   * - A refused path is 403 with the same message whether it escaped the
   *   project or simply is not there, so this is not a probe for what exists
   *   elsewhere on the disk.
   */
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/projects/:id/file',
    async (req, reply) => {
      const project = getProject(db, req.params.id);
      if (!project) {
        return reply.code(404).send({ error: 'no_such_project', message: 'No such project.' });
      }
      const parsed = fileQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'A path is required.' });
      }
      reply.header('x-content-type-options', 'nosniff');
      try {
        return reply.send(readProjectFile(project.path, parsed.data.path));
      } catch (err) {
        if (err instanceof OutsideProject) {
          req.log.warn({ project: project.id, path: parsed.data.path }, 'refused a path');
          return reply.code(403).send({ error: 'outside_project', message: err.message });
        }
        if (err instanceof NotPreviewable) {
          return reply.code(415).send({ error: 'not_previewable', message: err.message });
        }
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply
            .code(404)
            .send({ error: 'no_such_file', message: 'That file is not there any more.' });
        }
        req.log.error({ err }, 'could not read a file for preview');
        return reply.code(500).send({ error: 'read_failed', message: 'Could not read that file.' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    await sessions.end(db, req.params.id);
    audit(db, { event: 'session.end', actor: deviceOf(req), detail: { session: req.params.id } });
    req.log.info({ id: req.params.id }, 'session ended');
    return { ok: true };
  });

  /**
   * Forgetting an ended session — the row, its hooks, its questions.
   *
   * A separate route from ending on purpose. Ending stops the work and leaves
   * the record to read; this destroys the record, so it refuses while anything
   * is still running rather than quietly doing both.
   *
   * Claude Code's own transcript, under ~/.claude, is not touched. That is its
   * file, not ours.
   */
  app.delete<{ Params: { id: string } }>('/api/sessions/:id/record', async (req, reply) => {
    const row = sessions.get(db, req.params.id);
    if (!row) {
      return reply.code(404).send({ error: 'no_such_session', message: 'No such session.' });
    }
    // The row is only half the answer: rows are reconciled against tmux, and a
    // session tmux still has is running whatever the column says.
    if (!row.ended_at || (await hasSession(sessionName(req.params.id)))) {
      return reply.code(409).send({
        error: 'still_running',
        message: 'That session is still running. End it first.',
      });
    }
    try {
      sessions.remove(db, config, req.params.id);
    } catch (err) {
      if (err instanceof sessions.StillRunning) {
        return reply.code(409).send({ error: 'still_running', message: err.message });
      }
      throw err;
    }
    audit(db, {
      event: 'session.delete',
      actor: deviceOf(req),
      detail: { session: req.params.id, title: row.title },
    });
    req.log.info({ id: req.params.id }, 'session record deleted');
    return { ok: true };
  });
}
