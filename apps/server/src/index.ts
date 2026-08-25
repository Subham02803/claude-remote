import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { type Db, openDatabase } from './db/index.js';

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

  let db: Db;
  try {
    db = openDatabase(config, console);
  } catch (err) {
    fail(`Could not open the database at ${config.databasePath}.\n\n${String(err)}`);
  }

  const app = await buildApp({ config, db, startedAt });

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
