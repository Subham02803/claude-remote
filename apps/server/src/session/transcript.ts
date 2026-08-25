import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatBlock, ChatMessage, Transcript } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { Config } from '../config.js';

/**
 * The conversation, read from Claude Code's own transcript.
 *
 * The terminal cannot answer "show me the start of this conversation": tmux
 * keeps a fixed number of lines and a TUI repaints over itself, so scrolling up
 * far enough eventually finds nothing. The transcript is the whole thing, from
 * the first prompt, and it is structured — which is the only reason a chat view
 * can show tool calls as tool calls rather than as text that happens to look
 * like one.
 *
 * Read-only, and never written to. This is Claude Code's file, not ours.
 */

/** Claude Code names the directory after the cwd, every separator turned into a dash. */
function projectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * Where this session's transcript is, if it has one yet.
 *
 * Needs the id Claude reported at `SessionStart` — before that lands there is
 * nothing to read, which is normal for the first second of a session.
 */
export function transcriptFile(db: Database, config: Config, sessionId: string): string | null {
  const row = db
    .prepare('SELECT project_id, claude_session_id FROM sessions WHERE id = ?')
    .get(sessionId) as { project_id: string; claude_session_id: string | null } | undefined;
  if (!row?.claude_session_id) return null;

  const project = config.projects.find((p) => p.id === row.project_id);
  if (!project) return null;

  const path = join(
    homedir(),
    '.claude',
    'projects',
    projectDir(project.path),
    `${row.claude_session_id}.jsonl`,
  );
  return existsSync(path) ? path : null;
}

/** A tool result can be a whole file. Nobody reads that in a chat bubble. */
const MAX_RESULT_CHARS = 2000;

function cut(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_RESULT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_RESULT_CHARS), truncated: true };
}

/** Tool results arrive as a string or as content blocks; both mean text here. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) =>
      b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '',
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * The one line worth showing for a call, before anyone expands it.
 *
 * Every tool has a different idea of what it is doing, and the useful part is
 * never in the same key twice — so this is a lookup rather than something
 * clever over the input object.
 */
function summarise(name: string, input: Record<string, unknown>): string {
  const s = (k: string): string | null => {
    const v = input[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  switch (name) {
    case 'Bash':
      return s('command') ?? '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return s('file_path') ?? s('path') ?? '';
    case 'Grep':
      return s('pattern') ?? '';
    case 'Glob':
      return s('pattern') ?? '';
    case 'Task':
      return s('description') ?? s('subagent_type') ?? '';
    case 'WebFetch':
      return s('url') ?? '';
    case 'WebSearch':
      return s('query') ?? '';
    default: {
      // Unknown tool: show the first short string in its input rather than
      // nothing, which is usually the identifying one.
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.trim() && v.length < 200) return v.trim();
      }
      return '';
    }
  }
}

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

/**
 * Turns the transcript into messages.
 *
 * Tool results come back on the *following* user line rather than attached to
 * the call, so results are collected first and matched by id. Sidechain lines
 * are a subagent's own conversation and belong to the Agents tab, not here.
 */
export function parseTranscript(lines: Line[]): ChatMessage[] {
  const results = new Map<string, { text: string; ok: boolean }>();
  for (const line of lines) {
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block.type !== 'tool_result') continue;
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
      if (!id) continue;
      results.set(id, {
        text: resultText(block.content),
        ok: block.is_error !== true,
      });
    }
  }

  const messages: ChatMessage[] = [];
  for (const line of lines) {
    if (line.isSidechain || line.isMeta) continue;
    const role = line.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const content = line.message?.content;
    const blocks: ChatBlock[] = [];

    if (typeof content === 'string') {
      if (content.trim()) blocks.push({ kind: 'text', text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        const block = b as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') {
          if (block.text.trim()) blocks.push({ kind: 'text', text: block.text });
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          blocks.push({ kind: 'thinking', text: block.thinking });
        } else if (block.type === 'tool_use') {
          const id = typeof block.id === 'string' ? block.id : '';
          const name = typeof block.name === 'string' ? block.name : 'tool';
          const input = (block.input ?? {}) as Record<string, unknown>;
          const found = results.get(id);
          const { text, truncated } = found ? cut(found.text) : { text: '', truncated: false };
          blocks.push({
            kind: 'tool',
            name,
            summary: summarise(name, input),
            result: found ? text : null,
            ok: found ? found.ok : true,
            truncated,
          });
        }
        // tool_result blocks are consumed above, not shown as their own message.
      }
    }

    if (!blocks.length) continue;

    // Claude Code writes one transcript line per tool call, so a single turn
    // arrives as a dozen consecutive assistant lines. Merged here rather than
    // in the view: it is a property of the format, and a chat that reprints
    // "Claude" above every Bash call is unreadable.
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.blocks.push(...blocks);
      continue;
    }

    messages.push({
      id: line.uuid ?? `${messages.length}`,
      role,
      at: line.timestamp ?? '',
      blocks,
    });
  }
  return messages;
}

export function readTranscript(db: Database, config: Config, sessionId: string): Transcript {
  const path = transcriptFile(db, config, sessionId);
  if (!path) return { messages: [], found: false };

  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((raw) => {
      try {
        return [JSON.parse(raw) as Line];
      } catch {
        // A half-written last line is normal while a session is live.
        return [];
      }
    });

  return { messages: parseTranscript(lines), found: true };
}
