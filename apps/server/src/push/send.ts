import type { Database } from 'better-sqlite3';
import webpush from 'web-push';
import type { Config } from '../config.js';
import type { Log } from '../logger.js';

/**
 * Web Push.
 *
 * Two events are allowed to interrupt you: **blocked** and **failed**.
 * Everything else waits until you look. Scope §10 names notification fatigue as
 * a real risk, so this is enforced by there being no other caller rather than
 * by a setting that could drift.
 */

const PUBLIC_KEY = 'vapid_public_key';
const PRIVATE_KEY = 'vapid_private_key';

function meta(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Returns the VAPID public key, generating the pair on first use.
 *
 * Kept in the database rather than configuration: it is generated, not chosen,
 * and regenerating it would silently invalidate every device already
 * subscribed.
 */
export function vapidPublicKey(db: Database): string {
  let pub = meta(db, PUBLIC_KEY);
  const priv = meta(db, PRIVATE_KEY);
  if (pub && priv) return pub;

  const keys = webpush.generateVAPIDKeys();
  const put = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  );
  put.run(PUBLIC_KEY, keys.publicKey);
  put.run(PRIVATE_KEY, keys.privateKey);
  pub = keys.publicKey;
  return pub;
}

function configure(db: Database): boolean {
  const pub = meta(db, PUBLIC_KEY);
  const priv = meta(db, PRIVATE_KEY);
  if (!pub || !priv) return false;
  // The subject must be a mailto: or https: URL; push services reject anything
  // else. Nothing is sent to it — it is a contact of last resort.
  webpush.setVapidDetails('mailto:claude-remote@localhost', pub, priv);
  return true;
}

export interface Alert {
  /** Which session it is about, so tapping opens the right one. */
  sessionId: string;
  title: string;
  body: string;
  /** 'blocked' or 'failed'. Nothing else is allowed to interrupt. */
  kind: 'blocked' | 'failed';
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends an alert to every live subscription.
 *
 * Never throws: a push that cannot be delivered is not a reason for the thing
 * that triggered it to fail.
 */
export async function alert(
  db: Database,
  _config: Config,
  a: Alert,
  logger?: Log,
): Promise<number> {
  if (!configure(db)) return 0;

  const subs = db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE gone_at IS NULL')
    .all() as SubRow[];
  if (subs.length === 0) return 0;

  const payload = JSON.stringify(a);
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { urgency: 'high', TTL: 3600 },
        );
        db.prepare("UPDATE push_subs SET last_sent_at = datetime('now') WHERE endpoint = ?").run(
          s.endpoint,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the subscription is dead. Mark it rather than retrying
        // it forever on every future alert.
        if (status === 404 || status === 410) {
          db.prepare("UPDATE push_subs SET gone_at = datetime('now') WHERE endpoint = ?").run(
            s.endpoint,
          );
          logger?.info({ endpoint: s.endpoint.slice(0, 40) }, 'push subscription is gone');
        } else {
          logger?.warn({ err, status }, 'push failed');
        }
      }
    }),
  );

  return sent;
}
