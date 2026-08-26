import rateLimit from '@fastify/rate-limit';
import type { Database } from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { registerHookRoutes } from './hooks/routes.js';
import { seedWorkspaces } from './projects/store.js';
import { registerPushRoutes } from './push/routes.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWebRoutes } from './routes/web.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerWorkspaceAdminRoutes } from './routes/workspaces.js';
import { registerHostGuard } from './security/guard.js';
import { reconcile } from './session/store.js';
import { registerStreamRoutes } from './stream/routes.js';

export interface BuildOptions {
  config: Config;
  db: Db;
  startedAt: number;
  /** Silences the logger under test. */
  quiet?: boolean;
}

/**
 * Builds the server without listening on anything.
 *
 * Split out from `index.ts` so tests can drive a real instance — the host guard
 * is only worth anything if we can prove it runs, and proving it needs the
 * whole stack, not a mock.
 */
export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, db, startedAt } = opts;

  const app = Fastify({
    logger: opts.quiet
      ? false
      : {
          level: config.logLevel,
          transport:
            config.nodeEnv === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                }
              : undefined,
        },
    // `tailscale serve` terminates TLS and proxies to loopback, so the real
    // scheme and client address arrive in headers. Only that one hop is
    // trusted: with `true`, any caller could set X-Forwarded-For and choose
    // what req.ip says about them.
    trustProxy: ['127.0.0.1', '::1'],
    // This server holds long-lived sockets — a terminal never goes idle, and a
    // refused upgrade can leave a half-open connection behind. Without this,
    // close() waits for connections that will never end on their own and the
    // process hangs on shutdown.
    forceCloseConnections: true,
    disableRequestLogging: config.logLevel !== 'debug' && config.logLevel !== 'trace',
  });

  // Some endpoints are a POST with nothing to say. Fastify rejects an empty
  // body when the content type claims JSON, so accept it as an empty object
  // rather than making clients omit a header they would otherwise always send.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(Object.assign(new Error('Body is not valid JSON.'), { statusCode: 400 }), undefined);
    }
  });

  // Images arrive as their own bytes under their own content type — see
  // session/uploads.ts for why an image has to become a file at all. Fastify
  // has no parser for those, and a multipart dependency would buy nothing:
  // one image per request is what the composer sends either way.
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body as Buffer),
  );

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // Before every route, so a new subsystem cannot forget to opt in.
  registerHostGuard(app, config);

  // There has to be somewhere to start a session before anything can ask for
  // the list. Runs once, on the first boot against an empty database.
  seedWorkspaces(db.handle, config, app.log);

  await registerStreamRoutes(app, config, db.handle);
  registerWorkspaceRoutes(app, config, db.handle);
  registerWorkspaceAdminRoutes(app, config, db.handle);
  registerHookRoutes(app, config, db.handle);
  registerPushRoutes(app, config, db.handle);
  registerHealthRoutes(app, config, db, startedAt);

  // tmux may have outlived the last run of this process, so line the two up
  // before anyone asks what is running.
  await reconcile(db.handle, config, app.log);

  // Owns the not-found handler: Fastify allows only one per prefix, and what
  // a miss means depends on whether there is a built web app to fall back to.
  await registerWebRoutes(app, config, app.log);

  return app;
}

export type { Database };
