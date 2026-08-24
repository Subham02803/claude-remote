import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { registerAuthGuard } from './auth/guard.js';
import { ensureSetupToken } from './auth/setup.js';
import { purgeExpired } from './auth/store.js';
import { ConfigError, loadConfig } from './config.js';
import { type Db, openDatabase } from './db/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';

const startedAt = Date.now();

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      const list = err.problems.map((p) => `  - ${p}`).join('\n');
      fail(`claude-remote cannot start.\n\n${list}\n\nSee .env.example for what each value means.`);
    }
    throw err;
  }

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    // The tunnel terminates TLS, so the real scheme and client address arrive in
    // headers. This must be on before any cookie is issued: without it, Secure
    // cookies would be judged against http and every client would look like the
    // tunnel's own address.
    trustProxy: true,
    disableRequestLogging: config.logLevel !== 'debug' && config.logLevel !== 'trace',
  });

  let db: Db;
  try {
    db = openDatabase(config, app.log);
  } catch (err) {
    app.log.error({ err }, 'could not open the database');
    fail(`Could not open the database at ${config.databasePath}.`);
  }

  purgeExpired(db.handle);

  // Some endpoints — signing out, revoking every browser — are a POST with
  // nothing to say. Fastify rejects an empty body when the content type claims
  // JSON, so accept it as an empty object rather than making clients omit a
  // header they would otherwise always send.
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

  // Cookies must be registered before the guard, which reads them.
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    // One account, so limiting per address is about slowing down an attacker
    // rather than being fair between users.
    keyGenerator: (req) => req.ip,
  });

  registerAuthGuard(app, config, db.handle);
  registerAuthRoutes(app, config, db.handle);
  registerHealthRoutes(app, config, db, startedAt);

  app.setNotFoundHandler(async (_req, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' }),
  );

  for (const w of config.warnings) app.log.warn(w);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error({ err }, 'could not listen');
    fail(`Could not listen on ${config.host}:${config.port}. Is something else using the port?`);
  }

  app.log.info(
    { authMode: config.authMode, publicUrl: config.publicUrl ?? '(none)', version: config.version },
    'claude-remote server ready',
  );

  // Printed after the ready line so it is the last thing on the console.
  ensureSetupToken(db.handle, config, app.log);
}

void main();
