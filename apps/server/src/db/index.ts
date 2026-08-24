import { mkdirSync } from 'node:fs';
import SQLite, { type Database } from 'better-sqlite3';
import { type Config, databaseDir } from '../config.js';
import type { Log } from '../logger.js';
import { migrate } from './migrate.js';

export interface Db {
  handle: Database;
  migrationsApplied: number;
  close(): void;
}

/**
 * Opens the database, creating its directory if needed, and brings the schema
 * up to date.
 *
 * WAL is on so a long read never blocks a write; foreign keys are on because
 * SQLite leaves them off by default and silently ignores them otherwise.
 */
export function openDatabase(config: Config, logger: Log): Db {
  mkdirSync(databaseDir(config), { recursive: true });

  const handle = new SQLite(config.databasePath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');

  const migrationsApplied = migrate(handle, logger);
  logger.info({ path: config.databasePath, migrationsApplied }, 'database ready');

  return {
    handle,
    migrationsApplied,
    close: () => handle.close(),
  };
}
