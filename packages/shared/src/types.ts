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
