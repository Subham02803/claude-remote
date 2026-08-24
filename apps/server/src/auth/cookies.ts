import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'cr_session';
export const SETUP_COOKIE = 'cr_setup';

/**
 * Cookie options for this request.
 *
 * `secure` is decided per request rather than from configuration because the
 * same server is reached over plain http on loopback during development and
 * over https through the tunnel. Hard-coding it either way breaks one of them:
 * a Secure cookie is dropped on http, and a non-Secure one is a liability on
 * the public internet. `trustProxy` is what makes req.protocol trustworthy here.
 */
export function cookieOptions(req: FastifyRequest, maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function clearCookieOptions(req: FastifyRequest): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    path: '/',
  };
}
