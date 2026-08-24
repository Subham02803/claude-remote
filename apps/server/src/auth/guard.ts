import type { SessionUser } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { SESSION_COOKIE } from './cookies.js';
import { findSession, getUser, touchSession } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
  }
}

/**
 * Paths reachable without a session.
 *
 * This is an allowlist rather than a per-route opt-in on purpose: with the app
 * on a public tunnel, one route where somebody forgot to add a check would leak
 * everything. Forgetting to add a path here fails closed instead.
 */
const PUBLIC_EXACT = new Set(['/api/health']);
const PUBLIC_PREFIXES = ['/api/auth/', '/auth/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** The stand-in owner used when authentication is switched off entirely. */
export const LOCAL_USER: SessionUser = {
  id: 'local',
  email: 'local@localhost',
  displayName: 'Local',
};

/**
 * Resolves the caller's session without enforcing anything. Route handlers that
 * are themselves public still need to know who is asking.
 */
export function resolveUser(
  req: FastifyRequest,
  config: Config,
  db: Database,
): { user: SessionUser | null; sessionId: string | null; stage: 'none' | 'pending' | 'active' } {
  if (config.authMode === 'none') return { user: LOCAL_USER, sessionId: null, stage: 'active' };

  const token = req.cookies[SESSION_COOKIE];
  if (!token) return { user: null, sessionId: null, stage: 'none' };

  const session = findSession(db, token);
  if (!session) return { user: null, sessionId: null, stage: 'none' };

  const user = getUser(db);
  if (!user || user.id !== session.user_id) return { user: null, sessionId: null, stage: 'none' };

  return {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    sessionId: session.id,
    stage: session.stage,
  };
}

export function registerAuthGuard(app: FastifyInstance, config: Config, db: Database): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req, reply) => {
    const resolved = resolveUser(req, config, db);

    // A pending session has proven identity but not the second layer, so it is
    // deliberately not attached as a user anywhere outside the auth routes.
    req.user = resolved.stage === 'active' ? resolved.user : null;
    req.sessionId = resolved.stage === 'active' ? resolved.sessionId : null;

    if (isPublic(req.url.split('?')[0] ?? '')) return;

    if (!req.user) {
      return reply.code(401).send({
        error: 'unauthenticated',
        message: 'Sign in first.',
      });
    }

    if (resolved.sessionId) touchSession(db, resolved.sessionId);
  });
}
