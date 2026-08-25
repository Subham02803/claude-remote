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
