import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { type Config, repoRoot } from '../config.js';
import type { Log } from '../logger.js';
import { attachDevWebApp } from './web-dev.js';

/**
 * Serves the web app.
 *
 * Either way it is this port: one origin for the API, the terminal socket and
 * the page. In development the assets come from Vite, running inside this
 * process — see web-dev.ts. Anywhere else they come from
 * `pnpm --filter web build`, and a copy that was never built serves nothing.
 */
export async function registerWebRoutes(
  app: FastifyInstance,
  config: Config,
  logger: Log,
): Promise<void> {
  const apiMiss = (url: string) => url.startsWith('/api/') || url.startsWith('/auth/');
  const dist = resolve(repoRoot, 'apps/web/dist');
  const built = existsSync(resolve(dist, 'index.html'));

  // Development takes Vite over `dist`, always. A build left over from last
  // week is the one thing worse than no web app at all: it looks right and it
  // is not the code being edited.
  let live = false;
  if (config.nodeEnv === 'development') {
    try {
      await attachDevWebApp(app, config, apiMiss);
      live = true;
      logger.info('serving the web app with Vite, in this process');
    } catch (err) {
      logger.error({ err }, 'could not start Vite');
    }
  }

  if (!live && built) {
    await app.register(fastifyStatic, { root: dist, index: ['index.html'] });
  } else if (!live) {
    logger.warn('no built web app; run `pnpm --filter @claude-remote/web build`');
  }

  // Fastify allows exactly one not-found handler per prefix, so this is the
  // only place it is set. With a build, anything that is not an API route and
  // not a real file is a client-side route and gets index.html. Under Vite it
  // is only ever reached by API misses — the rest never gets this far.
  app.setNotFoundHandler(async (req, reply) => {
    if (!live && built && !apiMiss(req.url)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' });
  });

  if (!live && built) logger.info({ dist }, 'serving the built web app');
}
