import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatBlock, ChatMessage, Transcript } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { Config } from '../config.js';
import { getProject } from '../projects/store.js';

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

  const project = getProject(db, row.project_id);
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

/**
 * Pulls our own upload paths out of a prompt.
 *
 * An image sent from a browser reaches Claude as a path (see
 * `session/uploads.ts`), so that is what the transcript records. Showing the
 * path back to the person who attached the picture is useless, so the path
 * becomes an image block and the sentence keeps only the words.
 *
 * Matched by the shape of names we mint rather than against a project path:
 * this function stays pure, and a name of that shape under that folder is one
 * of ours whichever project it came from.
 */
const NAME = String.raw`([0-9a-z]+-[0-9a-f]{6}\.(?:png|jpg|gif|webp))`;
const REF = String.raw`\/\.claude-remote\/uploads\/[A-Za-z0-9_-]+\/`;
// Quoted first, because a quoted path is the one that can contain a space —
// see `composePrompt` in uploads.ts, and every home directory with a name in it.
const UPLOAD_REF = new RegExp(`"[^"\n]*${REF}${NAME}"|[^\\s"]*${REF}${NAME}`, 'g');

export function splitUploads(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const rest = text.replace(UPLOAD_REF, (_all, quoted?: string, bare?: string) => {
    images.push((quoted ?? bare) as string);
    return '';
  });
  return { text: images.length ? rest.replace(/[ \t]+/g, ' ').trim() : text, images };
}

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  /** 'typed' | 'queued' | 'system'. Absent in transcripts written a few versions ago. */
  promptSource?: string;
  /** `{ kind: 'human' }` for something you said. Absent in older transcripts too. */
  origin?: { kind?: string } | null;
  message?: { role?: string; content?: unknown };
}

/** Every word of a message, for deciding whether it is one. */
function plainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) =>
      b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
        ? String((b as { text?: unknown }).text ?? '')
        : '',
    )
    .join('\n');
}

/**
 * User-role lines nobody typed.
 *
 * Claude Code files its own bookkeeping under the user's role: a background
 * task reporting in, the caveat it writes before a local command, that
 * command's output. As chat bubbles they read as things you said — a wall of
 * `<task-notification>` XML sitting above your own words, attributed to you.
 *
 * Recognised three ways because the format moved under us. `promptSource` and
 * `origin` are what current Claude Code sets; neither exists in a transcript
 * written a few versions ago, where the opening tag is the only evidence there
 * is. All three are positive matches on purpose: an unfamiliar line is shown,
 * because hiding something you actually said is the worse failure.
 */
const MACHINE_KINDS = new Set(['task-notification']);
const MACHINE_TAGS = ['<task-notification>', '<local-command-caveat>', '<local-command-stdout>'];

export function machineWritten(line: Line, text: string): boolean {
  if (line.promptSource === 'system') return true;
  const kind = line.origin?.kind;
  if (kind && MACHINE_KINDS.has(kind)) return true;
  const head = text.trimStart();
  return MACHINE_TAGS.some((tag) => head.startsWith(tag));
}

/**
 * A slash command, as the command rather than as its plumbing.
 *
 * Running `/compact` files a user line of `<command-name>`, `<command-message>`
 * and `<command-args>` tags. That one *is* something you did, so it belongs in
 * the conversation — but the tags are not what you typed, and dropping the
 * line entirely would leave the reset it causes unexplained.
 */
export function slashCommand(text: string): string | null {
  const name = /^\s*<command-name>([^<]{1,80})<\/command-name>/.exec(text);
  if (!name) return null;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  const command = name[1]?.trim() ?? '';
  if (!command) return null;
  return args ? `${command} ${args}` : command;
}

/**
 * Adds one piece of prose, with any images it carried alongside it.
 *
 * Only for what a person wrote: an assistant turn mentioning a path is talking
 * about the file, not attaching it.
 */
function pushText(blocks: ChatBlock[], role: 'user' | 'assistant', text: string): void {
  if (role !== 'user') {
    if (text.trim()) blocks.push({ kind: 'text', text });
    return;
  }
  const command = slashCommand(text);
  if (command) {
    blocks.push({ kind: 'text', text: command });
    return;
  }
  const { text: prose, images } = splitUploads(text);
  if (prose.trim()) blocks.push({ kind: 'text', text: prose });
  for (const name of images) blocks.push({ kind: 'image', name });
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

    // Bookkeeping Claude Code files under your role. Not a message.
    if (role === 'user' && machineWritten(line, plainText(content))) continue;

    const blocks: ChatBlock[] = [];

    if (typeof content === 'string') {
      pushText(blocks, role, content);
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        const block = b as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') {
          pushText(blocks, role, block.text);
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
