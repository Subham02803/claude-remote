import type { Database } from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Log } from '../logger.js';
import { digestsMatch, randomToken, sha256 } from './secrets.js';
import { deleteMeta, getMeta, needsSetup, setMeta } from './store.js';

const META_KEY = 'setup_token_hash';

/**
 * On an unclaimed installation, prints a one-time token to the terminal and
 * requires it before anyone can enrol.
 *
 * This exists because the app is meant to be reachable through a tunnel. Without
 * it, whoever loaded the URL first would become the owner. Requiring a value
 * that only appears on the machine's own console means you must already have
 * access to the machine to claim it.
 *
 * @returns the raw token when one was just minted, otherwise null.
 */
export function ensureSetupToken(db: Database, config: Config, logger: Log): string | null {
  if (config.authMode === 'none') return null;
  if (!needsSetup(db)) {
    // Claimed. Any leftover token is a loose end worth closing.
    if (getMeta(db, META_KEY)) deleteMeta(db, META_KEY);
    return null;
  }
  if (getMeta(db, META_KEY)) {
    logger.warn(
      'This installation is not claimed yet. Re-run with SETUP_TOKEN reset if you lost the token.',
    );
    return null;
  }

  const token = randomToken(24);
  setMeta(db, META_KEY, sha256(token));

  const url = config.publicUrl ?? `http://${config.host}:${config.port}`;
  const line = '─'.repeat(68);
  process.stdout.write(
    `\n${line}
  This installation has no owner yet.

  Open  ${url}
  Setup token:  ${token}

  The token is shown once, here, on purpose: holding it proves you have
  access to this machine. It stops anyone who finds the URL from
  claiming the account. Delete data/claude-remote.db to start over.
${line}\n\n`,
  );

  return token;
}

/** True when the supplied token matches the one printed at boot. */
export function setupTokenValid(db: Database, token: string): boolean {
  const stored = getMeta(db, META_KEY);
  if (!stored) return false;
  return digestsMatch(stored, sha256(token));
}

/** Called once enrolment finishes. The token must not outlive its one use. */
export function consumeSetupToken(db: Database): void {
  deleteMeta(db, META_KEY);
}
