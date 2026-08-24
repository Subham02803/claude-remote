import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { Log } from '../logger.js';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

interface Migration {
  name: string;
  sql: string;
}

function load(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

/**
 * Applies any migration not yet recorded, each inside its own transaction, in
 * filename order. Safe to call on every boot.
 *
 * @returns the total number of migrations now applied.
 */
export function migrate(db: Database, logger: Log): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const pending = load().filter((m) => !applied.has(m.name));

  for (const m of pending) {
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name);
    });
    try {
      run();
      logger.info({ migration: m.name }, 'migration applied');
    } catch (err) {
      // A failed migration leaves the database on the last good version.
      logger.error({ migration: m.name, err }, 'migration failed');
      throw err;
    }
  }

  if (!pending.length) logger.debug('database schema up to date');

  return applied.size + pending.length;
}
