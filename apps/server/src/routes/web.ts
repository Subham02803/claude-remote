import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { type Config, repoRoot } from '../config.js';
import type { Log } from '../logger.js';

/**
 * Serves the built web app, when there is one.
 *
 * In development the web app is served by Vite on its own port and this does
 * nothing. In a container — or anywhere `pnpm --filter web build` has run —
 * the whole app is one origin on one port, which is what makes a single
 * published port useful and keeps the host allowlist covering everything.
 */
export async function registerWebRoutes(
  app: FastifyInstance,
  _config: Config,
  logger: Log,
): Promise<void> {
  const apiMiss = (url: string) => url.startsWith('/api/') || url.startsWith('/auth/');
  const dist = resolve(repoRoot, 'apps/web/dist');
  const built = existsSync(resolve(dist, 'index.html'));

  if (built) {
    await app.register(fastifyStatic, { root: dist, index: ['index.html'] });
  } else {
    logger.debug('no built web app; expecting the Vite dev server instead');
  }

  // Fastify allows exactly one not-found handler per prefix, so this is the
  // only place it is set. With a build, anything that is not an API route and
  // not a real file is a client-side route and gets index.html.
  app.setNotFoundHandler(async (req, reply) => {
    if (built && !apiMiss(req.url)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' });
  });

  if (built) logger.info({ dist }, 'serving the built web app');
}
