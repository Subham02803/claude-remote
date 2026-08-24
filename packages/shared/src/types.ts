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

/* --------------------------- authentication ------------------------------ */

/**
 * Where the person is in the sign-in sequence. The server decides this and the
 * client renders it, so the two can never disagree about what happens next.
 */
export type AuthStep =
  /** Unclaimed installation: the token printed on the machine's console is needed. */
  | 'setup-token'
  /** Token accepted: choose how to sign in from now on. */
  | 'setup-identity'
  /** Scan the QR code and enter the first code to finish claiming the account. */
  | 'setup-totp'
  /** Claimed: prove who you are. */
  | 'identity'
  /** Identity proven: enter the code from the authenticator. */
  | 'totp'
  /** Signed in. */
  | 'ready';

/** What an authenticator app needs in order to enrol. */
export interface TotpEnrolment {
  otpauthUrl: string;
  /** The same URI as an inline QR image. */
  qrDataUrl: string;
  /** Shown so the secret can be typed by hand when a camera is not an option. */
  secret: string;
}

export interface AuthStatus {
  mode: AuthMode;
  step: AuthStep;
  user: SessionUser | null;
  /** Only on `setup-totp`. */
  enrolment?: TotpEnrolment;
  /** Seconds until codes are accepted again, when too many have failed. */
  lockedOutSeconds?: number;
}

/** A browser holding an active session. */
export interface DeviceSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  /** True for the browser making the request. */
  current: boolean;
}
