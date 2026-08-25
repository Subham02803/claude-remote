import type { Database } from 'better-sqlite3';

/**
 * Append-only record of anything worth being able to look back on.
 *
 * Every approval writes here — what was approved, from which device, and when.
 * The table has existed since migration 001; this is the first thing to use it.
 */
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
