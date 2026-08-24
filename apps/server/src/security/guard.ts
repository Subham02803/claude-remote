import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { makeHostAllowed } from './hosts.js';

/**
 * Rejects requests that name a host this server does not answer to.
 *
 * See `hosts.ts` for why this is about names rather than addresses. Two headers
 * matter, and they cover different shapes of the same attack:
 *
 * - `Host` is on every HTTP/1.1 request and reflects the address bar. A rebound
 *   page still carries the attacker's name here.
 * - `Origin` is on cross-origin requests and on every non-GET fetch. Checking it
 *   stops a page on an allowed-looking host from being scripted by one that is
 *   not, and is what a CSRF check would have done had there been a session to
 *   forge.
 *
 * Applied to everything, health included: an endpoint left out of a list like
 * this is exactly the hole that gets found later.
 */
export function registerHostGuard(app: FastifyInstance, config: Config): void {
  const allowed = makeHostAllowed(config.allowedHosts);

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (!host || !allowed(host)) {
      req.log.warn({ host, url: req.url }, 'rejected a request naming an unknown host');
      return reply.code(403).send({
        error: 'bad_host',
        message: 'This server does not answer to that host name.',
      });
    }

    const origin = req.headers.origin;
    // "null" is what a sandboxed iframe or a file:// page sends. Never allowed:
    // it is unattributable by definition.
    if (origin !== undefined) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return reply
          .code(403)
          .send({ error: 'bad_origin', message: 'That origin is not a valid URL.' });
      }
      if (!allowed(originHost)) {
        req.log.warn({ origin, url: req.url }, 'rejected a request from an unknown origin');
        return reply
          .code(403)
          .send({ error: 'bad_origin', message: 'That origin is not allowed.' });
      }
    }
  });
}
