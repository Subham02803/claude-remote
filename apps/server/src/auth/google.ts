import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { randomToken } from './secrets.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

// Google publishes its signing keys here and rotates them; jose caches and
// refreshes on its own, so this is created once rather than per request.
const jwks = createRemoteJWKSet(JWKS_URL);

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** The redirect URI Google must have registered, character for character. */
export function redirectUri(config: Config): string {
  const base = config.publicUrl ?? `http://${config.host}:${config.port}`;
  return `${base}/auth/google/callback`;
}

/** A PKCE pair. The verifier stays on the server; only its digest travels. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthUrl(config: Config, state: string, challenge: string): string {
  if (!config.google) throw new Error('Google is not configured');
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.google.clientId);
  url.searchParams.set('redirect_uri', redirectUri(config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // We only ever need to know who you are, once, at sign-in. Asking for offline
  // access would mean holding a refresh token we would never use.
  url.searchParams.set('access_type', 'online');
  // Always offer the account chooser: on a shared browser, silently reusing the
  // last Google account is a surprise, not a convenience.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export class GoogleAuthError extends Error {}

/**
 * Exchanges the authorization code and verifies the returned identity token
 * against Google's published keys.
 *
 * Verification is the part that matters: without checking the signature,
 * issuer and audience, an id_token is just a string anyone could have written.
 */
export async function exchangeCode(
  config: Config,
  code: string,
  codeVerifier: string,
): Promise<GoogleIdentity> {
  if (!config.google) throw new GoogleAuthError('Google is not configured');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(config),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GoogleAuthError(`Google rejected the code exchange (${res.status}): ${body}`);
  }

  const payload = (await res.json()) as { id_token?: string };
  if (!payload.id_token) throw new GoogleAuthError('Google returned no id_token.');

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(payload.id_token, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.google.clientId,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch (err) {
    throw new GoogleAuthError(
      `The identity token did not verify: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const email = typeof claims.email === 'string' ? claims.email : null;
  if (!email) throw new GoogleAuthError('The identity token carried no email address.');

  return {
    email: email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}
