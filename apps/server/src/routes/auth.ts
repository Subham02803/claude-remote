import type { AuthStatus, DeviceSession, TotpEnrolment } from '@claude-remote/shared';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  SETUP_COOKIE,
  clearCookieOptions,
  cookieOptions,
} from '../auth/cookies.js';
import { GoogleAuthError, buildAuthUrl, createPkce, exchangeCode } from '../auth/google.js';
import { LOCAL_USER, resolveUser } from '../auth/guard.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { decryptSecret, encryptSecret, randomToken } from '../auth/secrets.js';
import { consumeSetupToken, setupTokenValid } from '../auth/setup.js';
import {
  activateSession,
  audit,
  clearFailures,
  confirmTotp,
  consumeOauthFlow,
  createProvisionalUser,
  createSession,
  findSession,
  getUser,
  listSessions,
  markLogin,
  needsSetup,
  recentFailures,
  recordAttempt,
  revokeAllSessions,
  revokeSession,
  saveOauthFlow,
  setTotpSecret,
} from '../auth/store.js';
import { generateTotpSecret, otpauthQr, otpauthUrl, verifyTotp } from '../auth/totp.js';
import type { Config } from '../config.js';

/** How long identity stays proven while waiting for the code. */
const PENDING_TTL = 10 * 60;
/** A browser that was not marked trusted. */
const ACTIVE_TTL = 12 * 60 * 60;
/** "Trust this browser for 30 days". */
const TRUSTED_TTL = 30 * 24 * 60 * 60;
/** Long enough to walk to the machine and read the console, no longer. */
const SETUP_TTL = 15 * 60;
const OAUTH_TTL = 10 * 60;

/** Codes are six digits; guessing gets expensive quickly at this threshold. */
const MAX_TOTP_FAILURES = 8;
const LOCKOUT_MINUTES = 15;

function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}
function clientAgent(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 400) : null;
}

/** Case-insensitive address comparison; Google may return different casing. */
function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function enrolmentFor(
  config: Config,
  db: Database,
  userId: string,
  email: string,
): Promise<TotpEnrolment> {
  const secret = generateTotpSecret();
  setTotpSecret(db, userId, encryptSecret(secret, config.sessionSecret!));
  return {
    otpauthUrl: otpauthUrl(secret, email),
    qrDataUrl: await otpauthQr(secret, email),
    secret,
  };
}

function issuePending(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Database,
  userId: string,
): void {
  const { token } = createSession(db, {
    userId,
    stage: 'pending',
    ttlSeconds: PENDING_TTL,
    ip: clientIp(req),
    userAgent: clientAgent(req),
  });
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(req, PENDING_TTL));
}

export function registerAuthRoutes(app: FastifyInstance, config: Config, db: Database): void {
  const rateLimited = {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  };

  /* ------------------------------- status -------------------------------- */

  app.get('/api/auth/status', async (req): Promise<AuthStatus> => {
    if (config.authMode === 'none') {
      return { mode: 'none', step: 'ready', user: LOCAL_USER };
    }

    const resolved = resolveUser(req, config, db);
    const user = getUser(db);
    const unclaimed = needsSetup(db);

    if (unclaimed) {
      // Enrolment in progress: a provisional user with a secret already issued.
      if (resolved.stage === 'pending' && user && user.totp_secret && !user.totp_confirmed_at) {
        const secret = decryptSecret(user.totp_secret, config.sessionSecret!);
        if (secret) {
          return {
            mode: config.authMode,
            step: 'setup-totp',
            user: null,
            enrolment: {
              otpauthUrl: otpauthUrl(secret, user.email),
              qrDataUrl: await otpauthQr(secret, user.email),
              secret,
            },
          };
        }
      }
      const setupToken = req.cookies[SETUP_COOKIE];
      const claimed = !!setupToken && setupTokenValid(db, setupToken);
      return {
        mode: config.authMode,
        step: claimed ? 'setup-identity' : 'setup-token',
        user: null,
      };
    }

    if (resolved.stage === 'active') {
      return { mode: config.authMode, step: 'ready', user: resolved.user };
    }

    const failures = recentFailures(db, 'totp', LOCKOUT_MINUTES);
    const locked = failures >= MAX_TOTP_FAILURES ? LOCKOUT_MINUTES * 60 : undefined;

    if (resolved.stage === 'pending') {
      return { mode: config.authMode, step: 'totp', user: null, lockedOutSeconds: locked };
    }
    return { mode: config.authMode, step: 'identity', user: null, lockedOutSeconds: locked };
  });

  /* ---------------------------- claim the box ---------------------------- */

  const claimBody = z.object({ token: z.string().min(1) });

  app.post('/api/auth/setup/claim', rateLimited, async (req, reply) => {
    if (config.authMode === 'none') {
      return reply.code(400).send({ error: 'not_applicable', message: 'Sign-in is switched off.' });
    }
    if (!needsSetup(db)) {
      return reply
        .code(409)
        .send({ error: 'already_claimed', message: 'This installation already has an owner.' });
    }
    const parsed = claimBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'A setup token is required.' });
    }
    if (!setupTokenValid(db, parsed.data.token.trim())) {
      audit(db, { event: 'setup.token_rejected', ip: clientIp(req), userAgent: clientAgent(req) });
      return reply.code(403).send({
        error: 'bad_token',
        message: 'That token does not match the one printed on the machine.',
      });
    }
    reply.setCookie(SETUP_COOKIE, parsed.data.token.trim(), cookieOptions(req, SETUP_TTL));
    audit(db, { event: 'setup.token_accepted', ip: clientIp(req), userAgent: clientAgent(req) });
    return { ok: true };
  });

  function holdsSetupToken(req: FastifyRequest): boolean {
    const t = req.cookies[SETUP_COOKIE];
    return !!t && setupTokenValid(db, t);
  }

  /* -------------------------- local: enrol + login ----------------------- */

  const localSetupBody = z.object({
    email: z.string().email(),
    password: z.string().min(10, 'Use at least 10 characters.'),
  });

  app.post('/api/auth/setup/local', rateLimited, async (req, reply) => {
    if (config.authMode !== 'local') {
      return reply
        .code(400)
        .send({ error: 'wrong_mode', message: `This installation uses ${config.authMode}.` });
    }
    if (!needsSetup(db)) {
      return reply
        .code(409)
        .send({ error: 'already_claimed', message: 'This installation already has an owner.' });
    }
    if (!holdsSetupToken(req)) {
      return reply
        .code(403)
        .send({ error: 'setup_required', message: 'Enter the setup token first.' });
    }
    const parsed = localSetupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: parsed.error.issues[0]?.message ?? 'Check the address and password.',
      });
    }

    const user = createProvisionalUser(db, {
      email: parsed.data.email.toLowerCase(),
      displayName: null,
      passwordHash: await hashPassword(parsed.data.password),
    });
    const enrolment = await enrolmentFor(config, db, user.id, user.email);
    issuePending(req, reply, db, user.id);
    audit(db, { event: 'setup.local_identity', actor: user.email, ip: clientIp(req) });
    return { enrolment };
  });

  const loginBody = z.object({ password: z.string().min(1) });

  app.post('/api/auth/login', rateLimited, async (req, reply) => {
    if (config.authMode !== 'local') {
      return reply
        .code(400)
        .send({ error: 'wrong_mode', message: `This installation uses ${config.authMode}.` });
    }
    const user = getUser(db);
    if (!user || !user.password_hash || !user.totp_confirmed_at) {
      return reply
        .code(409)
        .send({ error: 'setup_required', message: 'This installation is not set up yet.' });
    }
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'A password is required.' });
    }
    if (recentFailures(db, 'password', LOCKOUT_MINUTES) >= MAX_TOTP_FAILURES) {
      return reply.code(429).send({
        error: 'locked_out',
        message: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      });
    }

    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    recordAttempt(db, 'password', clientIp(req), ok);
    if (!ok) {
      audit(db, { event: 'login.password_failed', ip: clientIp(req) });
      return reply.code(401).send({ error: 'bad_credentials', message: 'That password is wrong.' });
    }
    clearFailures(db, 'password');
    issuePending(req, reply, db, user.id);
    audit(db, { event: 'login.password_ok', actor: user.email, ip: clientIp(req) });
    return { ok: true };
  });

  /* ------------------------------- google -------------------------------- */

  app.get('/auth/google/start', async (req, reply) => {
    if (config.authMode !== 'google' || !config.google) {
      return reply
        .code(400)
        .send({ error: 'wrong_mode', message: 'Google sign-in is not configured.' });
    }
    const unclaimed = needsSetup(db);
    if (unclaimed && !holdsSetupToken(req)) {
      return reply
        .code(403)
        .send({ error: 'setup_required', message: 'Enter the setup token first.' });
    }

    const state = randomToken(24);
    const pkce = createPkce();
    saveOauthFlow(db, {
      state,
      codeVerifier: pkce.verifier,
      isSetup: unclaimed,
      ttlSeconds: OAUTH_TTL,
    });
    return reply.redirect(buildAuthUrl(config, state, pkce.challenge));
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const home = `${config.publicUrl ?? ''}/`;
    const query = req.query as Record<string, string | undefined>;

    const fail = (reason: string, detail?: string) => {
      audit(db, { event: 'login.google_failed', detail: { reason, detail }, ip: clientIp(req) });
      recordAttempt(db, 'oauth', clientIp(req), false);
      return reply.redirect(`${home}?error=${encodeURIComponent(reason)}`);
    };

    if (config.authMode !== 'google' || !config.google) return fail('google_not_configured');
    if (query.error) return fail(query.error);
    if (!query.code || !query.state) return fail('missing_code');

    const flow = consumeOauthFlow(db, query.state);
    if (!flow) return fail('stale_request');

    let identity: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      identity = await exchangeCode(config, query.code, flow.codeVerifier);
    } catch (err) {
      const message = err instanceof GoogleAuthError ? err.message : String(err);
      req.log.warn({ err }, 'google exchange failed');
      return fail('exchange_failed', message);
    }

    if (!identity.emailVerified) return fail('email_unverified');
    // One installation, one account. Checked here and not only at setup, so a
    // second Google account can never reach the pending stage.
    if (!sameEmail(identity.email, config.allowedEmail)) {
      req.log.warn({ email: identity.email }, 'rejected sign-in for a non-allowed address');
      return fail('not_allowed');
    }

    if (flow.isSetup) {
      if (!needsSetup(db)) return fail('already_claimed');
      if (!holdsSetupToken(req)) return fail('setup_required');
      const user = createProvisionalUser(db, {
        email: identity.email,
        displayName: identity.name,
        passwordHash: null,
      });
      await enrolmentFor(config, db, user.id, user.email);
      issuePending(req, reply, db, user.id);
      audit(db, { event: 'setup.google_identity', actor: user.email, ip: clientIp(req) });
      return reply.redirect(home);
    }

    const user = getUser(db);
    if (!user || !user.totp_confirmed_at) return fail('setup_required');
    if (!sameEmail(identity.email, user.email)) return fail('not_allowed');

    recordAttempt(db, 'oauth', clientIp(req), true);
    issuePending(req, reply, db, user.id);
    audit(db, { event: 'login.google_ok', actor: user.email, ip: clientIp(req) });
    return reply.redirect(home);
  });

  /* -------------------------------- totp --------------------------------- */

  const totpBody = z.object({
    code: z.string().min(6).max(9),
    trustBrowser: z.boolean().optional(),
  });

  /**
   * One endpoint for both enrolling and signing in: the difference is whether
   * the secret has been confirmed before, which the server already knows.
   */
  app.post('/api/auth/totp', rateLimited, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    const session = token ? findSession(db, token) : null;
    if (!session || session.stage !== 'pending') {
      return reply
        .code(401)
        .send({ error: 'no_pending_session', message: 'Start again from the beginning.' });
    }
    const user = getUser(db);
    if (!user || user.id !== session.user_id || !user.totp_secret) {
      return reply
        .code(409)
        .send({ error: 'no_secret', message: 'Start again from the beginning.' });
    }
    const parsed = totpBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'Enter the six-digit code.' });
    }
    if (recentFailures(db, 'totp', LOCKOUT_MINUTES) >= MAX_TOTP_FAILURES) {
      return reply.code(429).send({
        error: 'locked_out',
        message: `Too many wrong codes. Try again in ${LOCKOUT_MINUTES} minutes.`,
      });
    }

    const secret = decryptSecret(user.totp_secret, config.sessionSecret!);
    if (!secret) {
      req.log.error('stored authenticator secret could not be decrypted');
      return reply.code(500).send({
        error: 'secret_unreadable',
        message:
          'The stored authenticator secret could not be read. SESSION_SECRET may have changed.',
      });
    }

    const ok = verifyTotp(parsed.data.code, secret, user.email);
    recordAttempt(db, 'totp', clientIp(req), ok);
    if (!ok) {
      audit(db, { event: 'totp.failed', actor: user.email, ip: clientIp(req) });
      return reply.code(401).send({ error: 'bad_code', message: 'That code is not right.' });
    }

    const enrolling = !user.totp_confirmed_at;
    if (enrolling) {
      confirmTotp(db, user.id);
      consumeSetupToken(db);
      reply.clearCookie(SETUP_COOKIE, clearCookieOptions(req));
    }

    const ttl = parsed.data.trustBrowser ? TRUSTED_TTL : ACTIVE_TTL;
    activateSession(db, session.id, ttl);
    markLogin(db, user.id);
    clearFailures(db, 'totp');
    reply.setCookie(SESSION_COOKIE, token!, cookieOptions(req, ttl));
    audit(db, {
      event: enrolling ? 'setup.completed' : 'login.completed',
      actor: user.email,
      detail: { trusted: !!parsed.data.trustBrowser },
      ip: clientIp(req),
      userAgent: clientAgent(req),
    });
    return { ok: true, enrolled: enrolling };
  });

  /* ------------------------------ sessions ------------------------------- */

  app.post('/api/auth/logout', async (req, reply) => {
    const resolved = resolveUser(req, config, db);
    if (resolved.sessionId) revokeSession(db, resolved.sessionId);
    reply.clearCookie(SESSION_COOKIE, clearCookieOptions(req));
    audit(db, { event: 'logout', actor: resolved.user?.email ?? null, ip: clientIp(req) });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', async (req, reply) => {
    const resolved = resolveUser(req, config, db);
    if (!resolved.user || resolved.stage !== 'active') {
      return reply.code(401).send({ error: 'unauthenticated', message: 'Sign in first.' });
    }
    const count = revokeAllSessions(db);
    reply.clearCookie(SESSION_COOKIE, clearCookieOptions(req));
    audit(db, {
      event: 'logout_all',
      actor: resolved.user.email,
      detail: { revoked: count },
      ip: clientIp(req),
    });
    return { ok: true, revoked: count };
  });

  app.get('/api/auth/devices', async (req, reply) => {
    const resolved = resolveUser(req, config, db);
    if (!resolved.user || resolved.stage !== 'active') {
      return reply.code(401).send({ error: 'unauthenticated', message: 'Sign in first.' });
    }
    const rows = listSessions(db);
    const devices: DeviceSession[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      ip: r.ip,
      userAgent: r.user_agent,
      current: r.id === resolved.sessionId,
    }));
    return { devices };
  });
}
