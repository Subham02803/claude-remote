import { type ScryptOptions, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// Wrapped by hand rather than with promisify, whose types drop the options
// overload and would silently ignore the cost parameters below.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

// Node's defaults, stated rather than assumed so a future change to them does
// not silently invalidate every stored digest.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

/**
 * Hashes a password with scrypt. Chosen over argon2 because it is built into
 * Node: one less native module to compile on every fresh clone.
 *
 * Format: scrypt$N$r$p$salt$digest
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), digest.toString('base64url')].join('$');
}

/** Verifies a password against a stored digest, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');

  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
