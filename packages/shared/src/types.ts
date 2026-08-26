/**
 * Types shared by the server and the web app. Anything crossing the HTTP
 * boundary belongs here, so the two sides cannot drift.
 */

/** Liveness check. */
export interface Health {
  ok: true;
  name: string;
  version: string;
  uptimeSeconds: number;
}

/** Diagnostics. Reachable by anything that can reach the server at all. */
export interface HealthDetail extends Health {
  /** The name this server is reached by from other devices, when there is one. */
  publicUrl: string | null;
  bind: { host: string; port: number };
  /** Host names answered to beyond loopback and the tailnet. */
  allowedHosts: string[];
  database: { migrationsApplied: number };
  /** Configuration that is legal but worth shouting about. */
  warnings: string[];
}

/** Shape of an error response from any endpoint. */
export interface ApiError {
  error: string;
  message: string;
}

/* ------------------------------ workspace -------------------------------- */

/** A folder Claude may be started in. Named on purpose, never discovered. */
export interface Project {
  id: string;
  /** The workspace it belongs to. */
  workspaceId: string;
  name: string;
  path: string;
  /** How many live sessions are running in it. */
  sessions: number;
}

/**
 * A named group of projects.
 *
 * There is always at least one: the server makes a default workspace on first
 * boot rather than ever showing an empty picker.
 */
export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  projects: Project[];
}

/* ----------------------------- folder picker ----------------------------- */

/**
 * One folder offered by the picker.
 *
 * Only folders: a project is a directory, so files are not shown at all rather
 * than shown and refused.
 */
export interface FolderEntry {
  name: string;
  /** Relative to the home directory, with forward slashes on every platform. */
  path: string;
  /** Dot-prefixed on unix, or hidden by attribute on Windows. */
  hidden: boolean;
  /** True when it contains a .git — a strong hint that it is a project. */
  repo: boolean;
  /** True when it is already a project in some workspace. */
  added: boolean;
}

/**
 * A folder listing from the picker, always rooted at the home directory.
 *
 * `home` and `sep` are for display only. The browser never builds an absolute
 * path — every request is relative to home, which is what keeps the picker
 * identical on macOS and Windows.
 */
export interface FolderListing {
  /** The home directory itself, spelled the way this platform spells it. */
  home: string;
  /** '/' or '\\', for showing a path the way the machine would write it. */
  sep: string;
  /** Where we are, relative to home. '' is home itself. */
  path: string;
  /** The folder above, relative to home; null at home. */
  parent: string | null;
  entries: FolderEntry[];
  /** True when the folder held more than the cap and was cut. */
  truncated: boolean;
}

/**
 * What a session is doing, as reported by Claude Code's own hooks.
 * Never guessed from the terminal — see docs/03-implementation-plan.md §5.
 */
export type SessionStatus = 'starting' | 'working' | 'waiting' | 'done' | 'failed' | 'ended';

/** True while the session still exists and could do something. */
export function isLive(s: { status: SessionStatus }): boolean {
  return s.status !== 'ended';
}

/**
 * True when there is a turn to interrupt.
 *
 * Not the same as `isLive`. A session sitting at the prompt after finishing is
 * very much alive — you can still talk to it — but there is nothing to stop,
 * and sending an interrupt anyway is not harmless: Ctrl-C at an idle Claude
 * Code prompt clears whatever you had typed into it.
 */
export function isStoppable(s: { status: SessionStatus }): boolean {
  return s.status === 'starting' || s.status === 'working' || s.status === 'waiting';
}

/**
 * A decision Claude is blocked on, as reported by the PermissionRequest hook.
 *
 * The hook tells us *that* a decision is needed and what it is about; the
 * answer goes back as a keystroke into the terminal, because the TUI is what
 * actually owns it. Hooks have a timeout, so parking one for a bus ride would
 * resolve as something you did not choose.
 */
/** One answer offered by a question, and the key that picks it. */
export interface AskOption {
  /** Its number in the terminal's list, which is what gets typed. 1-based. */
  n: number;
  label: string;
  description: string;
}

/**
 * A question with answers, rather than a thing to approve.
 *
 * `AskUserQuestion` is not a permission prompt: Claude is asking which of
 * several routes to take, and "approve" means nothing — pressing 1 picks the
 * first option, which is an answer nobody chose. Parsed out so the browser can
 * offer the same list the terminal does.
 */
export interface AskChoice {
  question: string;
  /** The short chip above it — 'Toggle bug', 'Storage', … */
  header: string;
  options: AskOption[];
  /**
   * True when the terminal wants several picked and confirmed together, which
   * one keystroke cannot do. Those stay answerable only in the Terminal tab.
   */
  multiSelect: boolean;
  /** How many more questions follow this one in the same call. */
  more: number;
}

export interface Ask {
  tool: string;
  /** The command, path, or whatever the tool was handed. Shown in full. */
  detail: string;
  askedAt: string;
  /** Set only for a question with options; null for an ordinary approval. */
  choice: AskChoice | null;
}

export interface Session {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  /** "your phone" / "this browser" — the device that started it (UC-8). */
  startedFrom: string | null;
  /** True while a browser is attached to it. */
  attached: boolean;
  /** A short phrase for the card: "running Bash", "needs your approval". */
  doing: string | null;
  /** When the status last changed, from a hook. */
  statusAt: string | null;
  /** Set only while genuinely blocked. Drives the approve/deny buttons. */
  ask: Ask | null;
}

/* -------------------------------- agents --------------------------------- */

/**
 * One agent working on a session: the main one, or a subagent it spawned.
 *
 * Built by pairing `Task` hook events, never by reading names off the terminal.
 * A subagent has no status of its own beyond "still open" or "finished" —
 * that is genuinely all the hooks report, and inventing more would break P6.
 */
export interface Agent {
  /** 'main', or the subagent type Claude was asked for ('Explore', …). */
  name: string;
  sub: boolean;
  status: 'working' | 'done';
  startedAt: string;
  endedAt: string | null;
  /** The one-line description the Task was given, when it had one. */
  doing: string | null;
}

/* ------------------------------- previews -------------------------------- */

/** How a previewable file should be shown. */
export type FileKind = 'md' | 'html' | 'text';

/**
 * One file read back for previewing, always as text.
 *
 * The server never returns this as `text/html`: an HTML prototype reaches the
 * page as a string and is only ever rendered inside a sandboxed frame.
 */
export interface FilePreview {
  /** Relative to the project root — the absolute path is not the browser's business. */
  path: string;
  kind: FileKind;
  text: string;
  bytes: number;
}

/* -------------------------------- edits ---------------------------------- */

/**
 * One change an agent made to a file, as the hook reported it.
 *
 * This is the *change*, not the file. `Edit` gives both sides; `Write` gives
 * only what was written, because there was no "before" it can honestly show —
 * the tool does not send one.
 */
export interface FileEdit {
  at: string;
  tool: string;
  /** What was replaced. Null for a Write, which reports no prior content. */
  before: string | null;
  /** What replaced it, or the whole content for a Write. */
  after: string | null;
  /** True when either side was cut to keep the response readable. */
  truncated: boolean;
}

/* ------------------------------ browsing --------------------------------- */

/** One entry in a project directory listing. */
export interface DirEntry {
  name: string;
  /** Path relative to the project root, for the next request. */
  path: string;
  dir: boolean;
  /** Null for directories. */
  bytes: number | null;
  /** How this file would be shown if opened; null when it cannot be. */
  kind: FileKind | null;
}

export interface DirListing {
  /** Relative to the project root; '' is the root itself. */
  path: string;
  entries: DirEntry[];
  /** True when the directory held more than the cap and was cut. */
  truncated: boolean;
}

/* ------------------------------ conversation ----------------------------- */

/**
 * One piece of a message.
 *
 * Modelled on what Claude Code actually writes to its transcript rather than on
 * what a chat UI wishes it had: an assistant turn is a sequence of thinking,
 * prose and tool calls, and flattening that to a single string would throw away
 * the part you most want to skim.
 */
export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  /**
   * An image sent from a browser, which reached Claude as a path in the
   * prompt. The path is stripped from the text and kept as its own block so
   * the chat can show the picture rather than the filename.
   */
  | { kind: 'image'; name: string }
  | {
      kind: 'tool';
      /** 'Read', 'Bash', 'Edit', … */
      name: string;
      /** One line describing the call — a path, a command, a query. */
      summary: string;
      /** What came back, capped. Null while the call is still open. */
      result: string | null;
      /** False when the tool reported an error. */
      ok: boolean;
      /** True when `result` was cut to fit. */
      truncated: boolean;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  at: string;
  blocks: ChatBlock[];
}

export interface Transcript {
  messages: ChatMessage[];
  /** False when Claude Code has not filed a transcript for this session yet. */
  found: boolean;
}

/* -------------------------------- uploads -------------------------------- */

/**
 * An image a browser sent, now sitting in the project where Claude can read
 * it. The name is how every endpoint refers to it; the path is what went into
 * the prompt, and is shown so it is never a mystery what Claude was handed.
 */
export interface Upload {
  name: string;
  path: string;
  mime: string;
  bytes: number;
}
