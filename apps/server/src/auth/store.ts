import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { randomToken, sha256 } from './secrets.js';

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  stage: 'pending' | 'active';
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}

/** SQLite has no date type; everything here is UTC ISO, which sorts correctly. */
function iso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

/* ------------------------------- users ---------------------------------- */

/** The owner, if enrolment ever got as far as creating a row. */
export function getUser(db: Database): UserRow | null {
  return (db.prepare('SELECT * FROM users LIMIT 1').get() as UserRow | undefined) ?? null;
}

/** True when nobody has finished enrolling, so the installation is unclaimed. */
export function needsSetup(db: Database): boolean {
  const user = getUser(db);
  return !user || !user.totp_confirmed_at;
}

export function createProvisionalUser(
  db: Database,
  input: { email: string; displayName: string | null; passwordHash: string | null },
): UserRow {
  // Enrolment can be restarted, and a half-finished row must never block that.
  db.prepare('DELETE FROM users WHERE totp_confirmed_at IS NULL').run();
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    input.email,
    input.displayName,
    input.passwordHash,
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

export function setTotpSecret(db: Database, userId: string, encrypted: string): void {
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(encrypted, userId);
}

export function confirmTotp(db: Database, userId: string): void {
  db.prepare("UPDATE users SET totp_confirmed_at = datetime('now') WHERE id = ?").run(userId);
}

export function markLogin(db: Database, userId: string): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
}

/* ------------------------------ sessions -------------------------------- */

export interface NewSession {
  token: string;
  row: SessionRow;
}

/**
 * Creates a session and returns the raw token exactly once. Only its digest is
 * stored, so a copy of the database does not hand anyone a live session.
 */
export function createSession(
  db: Database,
  input: {
    userId: string;
    stage: 'pending' | 'active';
    ttlSeconds: number;
    ip: string | null;
    userAgent: string | null;
  },
): NewSession {
  const token = randomToken();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, stage, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    sha256(token),
    input.stage,
    iso(input.ttlSeconds),
    input.ip,
    input.userAgent,
  );
  return { token, row: db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow };
}

/** Looks a session up by raw token, treating expired rows as absent. */
export function findSession(db: Database, token: string): SessionRow | null {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token)) as
    | SessionRow
    | undefined;
  if (!row) return null;
  if (row.expires_at <= iso()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }
  return row;
}

/** Promotes a pending session once the code is accepted, and re-dates it. */
export function activateSession(db: Database, sessionId: string, ttlSeconds: number): void {
  db.prepare("UPDATE sessions SET stage = 'active', expires_at = ? WHERE id = ?").run(
    iso(ttlSeconds),
    sessionId,
  );
}

export function touchSession(db: Database, sessionId: string): void {
  db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(sessionId);
}

export function revokeSession(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/** Signs every browser out. What the "lock all access" control calls. */
export function revokeAllSessions(db: Database): number {
  return db.prepare('DELETE FROM sessions').run().changes;
}

export function listSessions(db: Database): SessionRow[] {
  return db
    .prepare("SELECT * FROM sessions WHERE stage = 'active' ORDER BY last_seen_at DESC")
    .all() as SessionRow[];
}

/** Housekeeping, run on boot: expired rows are dead weight and noise. */
export function purgeExpired(db: Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso());
  db.prepare('DELETE FROM oauth_flows WHERE expires_at <= ?').run(iso());
}

/* ----------------------------- oauth flows ------------------------------ */

export function saveOauthFlow(
  db: Database,
  input: { state: string; codeVerifier: string; isSetup: boolean; ttlSeconds: number },
): void {
  db.prepare(
    'INSERT INTO oauth_flows (state, code_verifier, is_setup, expires_at) VALUES (?, ?, ?, ?)',
  ).run(input.state, input.codeVerifier, input.isSetup ? 1 : 0, iso(input.ttlSeconds));
}

/**
 * Reads a flow and deletes it in the same breath: a state parameter that can be
 * replayed is not protecting anything.
 */
export function consumeOauthFlow(
  db: Database,
  state: string,
): { codeVerifier: string; isSetup: boolean } | null {
  const row = db.prepare('SELECT * FROM oauth_flows WHERE state = ?').get(state) as
    | { state: string; code_verifier: string; is_setup: number; expires_at: string }
    | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM oauth_flows WHERE state = ?').run(state);
  if (row.expires_at <= iso()) return null;
  return { codeVerifier: row.code_verifier, isSetup: row.is_setup === 1 };
}

/* ---------------------------- attempts / meta --------------------------- */

export function recordAttempt(
  db: Database,
  kind: 'password' | 'totp' | 'oauth',
  ip: string | null,
  ok: boolean,
): void {
  db.prepare('INSERT INTO auth_attempts (kind, ip, ok) VALUES (?, ?, ?)').run(kind, ip, ok ? 1 : 0);
}

/** Failed attempts of one kind in the last N minutes, across all addresses. */
export function recentFailures(db: Database, kind: string, minutes: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM auth_attempts
       WHERE kind = ? AND ok = 0 AND at > datetime('now', ?)`,
    )
    .get(kind, `-${minutes} minutes`) as { n: number };
  return row.n;
}

export function clearFailures(db: Database, kind: string): void {
  db.prepare('DELETE FROM auth_attempts WHERE kind = ? AND ok = 0').run(kind);
}

export function getMeta(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

export function deleteMeta(db: Database, key: string): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}

/* -------------------------------- audit --------------------------------- */

export function audit(
  db: Database,
  input: {
    event: string;
    actor?: string | null;
    detail?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  },
): void {
  db.prepare(
    'INSERT INTO audit_log (event, actor, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).run(
    input.event,
    input.actor ?? null,
    input.detail === undefined ? null : JSON.stringify(input.detail),
    input.ip ?? null,
    input.userAgent ?? null,
  );
}
