import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ConfigError, loadConfig } from './config.js';
import { type Db, openDatabase } from './db/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerHostGuard } from './security/guard.js';

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
    // `tailscale serve` terminates TLS and proxies to loopback, so the real
    // scheme and client address arrive in headers. Only that one hop is
    // trusted: with `true`, any caller could set X-Forwarded-For and choose
    // what req.ip says about them.
    trustProxy: ['127.0.0.1', '::1'],
    disableRequestLogging: config.logLevel !== 'debug' && config.logLevel !== 'trace',
  });

  let db: Db;
  try {
    db = openDatabase(config, app.log);
  } catch (err) {
    app.log.error({ err }, 'could not open the database');
    fail(`Could not open the database at ${config.databasePath}.`);
  }

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

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // Before every route, so a new subsystem cannot forget to opt in.
  registerHostGuard(app, config);
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
    { publicUrl: config.publicUrl ?? '(none)', version: config.version },
    'claude-remote server ready',
  );
}

void main();
