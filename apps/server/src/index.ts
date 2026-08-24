import Fastify from 'fastify';
import { ConfigError, loadConfig } from './config.js';
import { type Db, openDatabase } from './db/index.js';
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
    // The tunnel terminates TLS, so the real scheme and client IP arrive in
    // headers. Needed before any cookie is issued: without it, Secure cookies
    // would be judged against http and the client IP would always be the tunnel.
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
    {
      authMode: config.authMode,
      publicUrl: config.publicUrl ?? '(none)',
      version: config.version,
    },
    'claude-remote server ready',
  );
}

void main();
