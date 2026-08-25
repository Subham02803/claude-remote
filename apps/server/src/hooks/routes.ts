import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { alert } from '../push/send.js';

/** What a hook payload looks like, in the parts we use. */
interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  message?: string;
  last_assistant_message?: string;
}

/**
 * How each event moves a session's status.
 *
 * `null` means "tells us something, but does not change what the session is
 * doing" — the event is still recorded.
 */
const STATUS: Record<string, 'working' | 'waiting' | 'done' | 'failed' | 'ended' | null> = {
  SessionStart: 'working',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'waiting',
  Notification: 'waiting',
  Stop: 'done',
  StopFailure: 'failed',
  SessionEnd: 'ended',
};

/**
 * The tool's input as one readable line.
 *
 * Bash gets its command, file tools get their path — the things you would need
 * to see before saying yes. Never truncated here; the screen decides how much
 * it can show, and it is not allowed to hide the whole thing.
 */
export function describeInput(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  try {
    return JSON.stringify(input).slice(0, 500);
  } catch {
    return null;
  }
}

/** A short phrase for the card, in the words the screen will use. */
function describe(p: HookPayload): string | null {
  const event = p.hook_event_name;
  const tool = p.tool_name;
  switch (event) {
    case 'SessionStart':
      return 'getting its bearings';
    case 'UserPromptSubmit':
      return 'reading your prompt';
    case 'PreToolUse':
      return tool ? `running ${tool}` : 'using a tool';
    case 'PostToolUse':
      return tool ? `finished ${tool}` : null;
    case 'PermissionRequest':
      return tool ? `needs approval to run ${tool}` : 'needs your approval';
    case 'Notification':
      return p.message ? p.message.slice(0, 120) : 'wants your attention';
    case 'Stop':
      return 'finished · nothing is waiting on you';
    case 'StopFailure':
      return 'stopped on an error';
    case 'SessionEnd':
      return 'session ended';
    default:
      return null;
  }
}

/**
 * Where Claude Code reports in.
 *
 * The session id is in the path because we put it there when we generated the
 * settings file, so no correlation guesswork is needed. This endpoint is for
 * Claude Code, never the browser — the host guard already keeps it off the
 * open web, and it only ever arrives over loopback.
 */
export function registerHookRoutes(app: FastifyInstance, config: Config, db: Database): void {
  app.post<{ Params: { id: string } }>('/api/hooks/:id', async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    // A hook for a session we do not know is not worth an error: the session
    // may have been ended a moment ago, and the hook must not stall Claude.
    if (!row) return reply.code(204).send();

    const p = (req.body ?? {}) as HookPayload;
    const event = String(p.hook_event_name ?? 'unknown');
    const tool = p.tool_name ?? null;

    db.prepare(
      'INSERT INTO session_events (session_id, event, tool, detail) VALUES (?, ?, ?, ?)',
    ).run(
      id,
      event,
      tool,
      JSON.stringify({
        input: p.tool_input ?? undefined,
        message: p.message ?? undefined,
        said: p.last_assistant_message?.slice(0, 400) ?? undefined,
      }),
    );

    const next = STATUS[event];
    const doing = describe(p);

    // An ask is open only while Claude is genuinely blocked on it. Opening one
    // here and closing it on the next event is what stops the phone showing an
    // Approve button that types into a prompt which has already moved on.
    if (event === 'PermissionRequest') {
      const detail = describeInput(p.tool_input) ?? p.message ?? '(no detail given)';
      db.prepare(
        'UPDATE asks SET answer = ?, answered_at = datetime(?) WHERE session_id = ? AND answered_at IS NULL',
      ).run('superseded', 'now', id);
      db.prepare('INSERT INTO asks (session_id, tool, detail) VALUES (?, ?, ?)').run(
        id,
        p.tool_name ?? 'unknown',
        detail,
      );
    } else if (next && next !== 'waiting') {
      // Anything that moves the session on means the question is answered,
      // whether it was answered here or by someone typing at the desk.
      db.prepare(
        "UPDATE asks SET answered_at = datetime('now'), answer = COALESCE(answer, 'elsewhere') WHERE session_id = ? AND answered_at IS NULL",
      ).run(id);
    }

    if (next) {
      db.prepare(
        "UPDATE sessions SET status = ?, status_at = datetime('now'), doing = ? WHERE id = ?",
      ).run(next, doing, id);
    } else if (doing) {
      db.prepare("UPDATE sessions SET doing = ?, status_at = datetime('now') WHERE id = ?").run(
        doing,
        id,
      );
    }

    // The first SessionStart is where Claude tells us its own id, which the
    // transcript on disk is keyed by.
    if (event === 'SessionStart' && p.session_id) {
      db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(p.session_id, id);
    }

    // The only two events allowed to interrupt you (scope §10). Deliberately
    // fired here and nowhere else, so "only two" is a property of the code
    // rather than a setting that can drift.
    if (next === 'waiting' || next === 'failed') {
      const title = db.prepare('SELECT title FROM sessions WHERE id = ?').get(id) as
        | { title: string }
        | undefined;
      // Not awaited: a slow push service must never hold up a hook, because a
      // held-up hook holds up Claude.
      void alert(
        db,
        config,
        {
          sessionId: id,
          kind: next === 'waiting' ? 'blocked' : 'failed',
          title: title?.title ?? 'claude-remote',
          body: doing ?? (next === 'waiting' ? 'Waiting on you.' : 'The run failed.'),
        },
        req.log,
      ).catch(() => {
        /* alert() already swallows and logs; this is belt and braces. */
      });
    }

    req.log.debug({ id, event, tool }, 'hook');
    return reply.code(204).send();
  });
}
