/**
 * Types shared by the server and the web app. Anything crossing the HTTP
 * boundary belongs here, so the two sides cannot drift.
 */

/** How the first authentication layer works. A code from an authenticator app
 *  is always the second layer for `google` and `local`. */
export type AuthMode = 'google' | 'local' | 'none';

/** Public liveness check. Safe to expose on the open internet. */
export interface Health {
  ok: true;
  name: string;
  version: string;
  uptimeSeconds: number;
}

/** Diagnostics. Never public: served only to loopback callers today, and
 *  behind authentication once that exists. */
export interface HealthDetail extends Health {
  authMode: AuthMode;
  /** The tunnel URL, when one is configured. */
  publicUrl: string | null;
  bind: { host: string; port: number };
  database: { path: string; migrationsApplied: number };
  /** Configuration that is legal but worth shouting about. */
  warnings: string[];
}

/** The signed-in owner. One per installation, by design. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

/** Shape of an error response from any endpoint. */
export interface ApiError {
  error: string;
  message: string;
}
