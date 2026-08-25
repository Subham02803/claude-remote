import type { Agent, SessionStatus } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';

/** One `Task` hook event, in the parts pairing needs. */
export interface TaskEvent {
  at: string;
  event: string;
  detail: string | null;
}

interface TaskInput {
  subagent_type?: unknown;
  description?: unknown;
}

function inputOf(detail: string | null): TaskInput {
  if (!detail) return {};
  try {
    return ((JSON.parse(detail) as { input?: TaskInput }).input ?? {}) as TaskInput;
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Turns Task hook events into the subagents that produced them.
 *
 * `PreToolUse(Task)` is a subagent starting and `PostToolUse(Task)` is one
 * finishing — that pairing is the only honest source we have, and it is the
 * reason this tab exists at all rather than reading names off the screen
 * (implementation plan, "Not doing": hooks or nothing).
 *
 * Two Tasks can be in flight at once, so a finish is matched to the *earliest
 * still-open* agent with the same type and description. Descriptions are what
 * distinguish parallel subagents in practice; when they collide the earliest
 * open one of that type is closed, which can mis-attribute an end time between
 * two identical agents but never invents or loses one.
 */
export function pairAgents(rows: TaskEvent[]): Agent[] {
  const open: Agent[] = [];
  const done: Agent[] = [];

  for (const row of rows) {
    const input = inputOf(row.detail);
    const name = str(input.subagent_type) ?? 'subagent';
    const doing = str(input.description);

    if (row.event === 'PreToolUse') {
      open.push({ name, sub: true, status: 'working', startedAt: row.at, endedAt: null, doing });
      continue;
    }
    if (row.event !== 'PostToolUse') continue;

    let at = open.findIndex((a) => a.name === name && a.doing === doing);
    if (at < 0) at = open.findIndex((a) => a.name === name);
    if (at < 0) continue;

    const agent = open.splice(at, 1)[0];
    if (!agent) continue;
    agent.status = 'done';
    agent.endedAt = row.at;
    done.push(agent);
  }

  // Still-running first: on a phone the top of the list is the part you read.
  return [...open, ...done];
}

/** The main agent, which is the session itself rather than a Task event. */
function mainAgent(row: {
  created_at: string;
  status: SessionStatus;
  status_at: string | null;
  doing: string | null;
}): Agent {
  const finished = row.status === 'done' || row.status === 'ended' || row.status === 'failed';
  return {
    name: 'main',
    sub: false,
    status: finished ? 'done' : 'working',
    startedAt: row.created_at,
    endedAt: finished ? row.status_at : null,
    doing: row.doing,
  };
}

/**
 * Who is working on this session: the main agent, then its subagents.
 *
 * Scope §5.1 asks to know whether Claude is working or stuck. With subagents
 * that question has more than one answer at a time, and a session that looks
 * idle is often four Tasks deep.
 */
export function readAgents(db: Database, sessionId: string): Agent[] {
  const session = db
    .prepare('SELECT created_at, status, status_at, doing FROM sessions WHERE id = ?')
    .get(sessionId) as
    | { created_at: string; status: SessionStatus; status_at: string | null; doing: string | null }
    | undefined;
  if (!session) return [];

  const rows = db
    .prepare(
      `SELECT at, event, detail FROM session_events
       WHERE session_id = ? AND tool = 'Task' AND event IN ('PreToolUse','PostToolUse')
       ORDER BY id ASC`,
    )
    .all(sessionId) as TaskEvent[];

  return [mainAgent(session), ...pairAgents(rows)];
}
