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

/** A folder Claude may be started in. Declared in config, never discovered. */
export interface Project {
  id: string;
  name: string;
  path: string;
  /** How many live sessions are running in it. */
  sessions: number;
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
 * A decision Claude is blocked on, as reported by the PermissionRequest hook.
 *
 * The hook tells us *that* a decision is needed and what it is about; the
 * answer goes back as a keystroke into the terminal, because the TUI is what
 * actually owns it. Hooks have a timeout, so parking one for a bus ride would
 * resolve as something you did not choose.
 */
export interface Ask {
  tool: string;
  /** The command, path, or whatever the tool was handed. Shown in full. */
  detail: string;
  askedAt: string;
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
