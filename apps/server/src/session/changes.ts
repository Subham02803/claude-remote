import { existsSync, readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';

export interface ChangedFile {
  path: string;
  /** How many times this session touched it. */
  edits: number;
  tool: string;
}

/**
 * What a session changed.
 *
 * Read from the hook event log rather than from the terminal, and cross-checked
 * against Claude Code's own transcript when we know where it is. Scope §5.1
 * asks to see *which* files changed; this answers that honestly, and does not
 * pretend to a line-level diff it has not got.
 */
export function readChanges(db: Database, sessionId: string): ChangedFile[] {
  const rows = db
    .prepare(
      `SELECT tool, detail FROM session_events
       WHERE session_id = ? AND event = 'PostToolUse' AND tool IN ('Write','Edit','Update','NotebookEdit')`,
    )
    .all(sessionId) as { tool: string; detail: string | null }[];

  const byPath = new Map<string, ChangedFile>();
  for (const r of rows) {
    if (!r.detail) continue;
    let path: string | undefined;
    try {
      const input = (JSON.parse(r.detail) as { input?: Record<string, unknown> }).input;
      const v = input?.file_path ?? input?.path;
      if (typeof v === 'string') path = v;
    } catch {
      continue;
    }
    if (!path) continue;
    const seen = byPath.get(path);
    if (seen) seen.edits += 1;
    else byPath.set(path, { path, edits: 1, tool: r.tool });
  }

  return [...byPath.values()].sort((a, b) => b.edits - a.edits);
}

/**
 * Where Claude Code filed this session's transcript, when we know.
 *
 * Captured from `SessionStart`. Kept separate because the transcript is the
 * richer source for a later step, and this is the only thing that knows the
 * path exists.
 */
export function transcriptPath(db: Database, sessionId: string): string | null {
  const row = db.prepare('SELECT claude_session_id FROM sessions WHERE id = ?').get(sessionId) as
    | { claude_session_id: string | null }
    | undefined;
  if (!row?.claude_session_id) return null;
  const guess = `${process.env.HOME}/.claude/projects`;
  return existsSync(guess) ? guess : null;
}

/** Reads a JSONL transcript, ignoring lines that will not parse. */
export function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}
