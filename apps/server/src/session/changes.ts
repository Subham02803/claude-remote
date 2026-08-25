import { existsSync, readFileSync } from 'node:fs';
import type { FileEdit } from '@claude-remote/shared';
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

/**
 * A single edit is not allowed to be enormous. A Write of a generated file can
 * be tens of thousands of lines, and nobody reviews that on a phone — the
 * Preview tab is where the whole file lives.
 */
const MAX_EDIT_LINES = 400;

function cut(text: string): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= MAX_EDIT_LINES) return { text, truncated: false };
  return { text: `${lines.slice(0, MAX_EDIT_LINES).join('\n')}\n`, truncated: true };
}

/**
 * What an agent actually changed in one file.
 *
 * Read straight from the tool input the hook forwarded, which is the honest
 * source: it is what Claude asked for, not a reconstruction from the file on
 * disk. Diffing against disk would be worse — the file has moved on since,
 * possibly several edits later, and would show changes this session never made.
 *
 * `Edit` carries both sides. `Write` carries only `content`, so `before` is
 * null rather than invented; the UI says "written" instead of showing a
 * one-sided diff as though something had been replaced.
 */
export function readEdits(db: Database, sessionId: string, path: string): FileEdit[] {
  const rows = db
    .prepare(
      `SELECT at, tool, detail FROM session_events
       WHERE session_id = ? AND event = 'PostToolUse'
         AND tool IN ('Write','Edit','Update','NotebookEdit')
       ORDER BY id ASC`,
    )
    .all(sessionId) as { at: string; tool: string; detail: string | null }[];

  const out: FileEdit[] = [];
  for (const row of rows) {
    if (!row.detail) continue;
    let input: Record<string, unknown> | undefined;
    try {
      input = (JSON.parse(row.detail) as { input?: Record<string, unknown> }).input;
    } catch {
      continue;
    }
    if (!input) continue;
    const at = input.file_path ?? input.path;
    if (at !== path) continue;

    const before = typeof input.old_string === 'string' ? input.old_string : null;
    const rawAfter =
      typeof input.new_string === 'string'
        ? input.new_string
        : typeof input.content === 'string'
          ? input.content
          : typeof input.new_source === 'string'
            ? input.new_source
            : null;

    const a = before === null ? null : cut(before);
    const b = rawAfter === null ? null : cut(rawAfter);
    out.push({
      at: row.at,
      tool: row.tool,
      before: a?.text ?? null,
      after: b?.text ?? null,
      truncated: Boolean(a?.truncated || b?.truncated),
    });
  }
  return out;
}
