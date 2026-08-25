import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { alert, vapidPublicKey } from './send.js';

const subscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  label: z.string().max(80).optional(),
});

export function registerPushRoutes(app: FastifyInstance, config: Config, db: Database): void {
  /** The key a browser needs before it can subscribe. */
  app.get('/api/push/key', async () => ({ key: vapidPublicKey(db) }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const parsed = subscribeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'That is not a push subscription.' });
    }
    const { endpoint, keys, label } = parsed.data;
    // Re-subscribing is normal — browsers rotate endpoints — so this is an
    // upsert, and it clears any previous "gone" mark.
    db.prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = excluded.p256dh, auth = excluded.auth,
         label = excluded.label, gone_at = NULL`,
    ).run(endpoint, keys.p256dh, keys.auth, label ?? null);
    req.log.info({ label }, 'device subscribed to alerts');
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
    if (!endpoint) {
      return reply.code(400).send({ error: 'bad_request', message: 'An endpoint is required.' });
    }
    db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
    return { ok: true };
  });

  app.get('/api/push/status', async () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE gone_at IS NULL').get() as {
      n: number;
    };
    return { devices: row.n };
  });

  /** Proves the whole chain without waiting for something to actually block. */
  app.post('/api/push/test', async (req) => {
    const sent = await alert(
      db,
      config,
      {
        sessionId: 'test',
        kind: 'blocked',
        title: 'claude-remote',
        body: 'Test alert — this is what a blocked run looks like.',
      },
      req.log,
    );
    return { sent };
  });
}
