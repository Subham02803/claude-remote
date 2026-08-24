import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/** A URL-safe random token. 32 bytes is 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hex SHA-256. Used to store tokens without storing the token. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compares two hex digests without leaking, through timing, how much of the
 * value matched. Length is checked first because timingSafeEqual throws on
 * mismatched buffers, and digest length is not a secret.
 */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Derives a 32-byte key from the session secret. The purpose string keeps keys
 * for different jobs distinct even though they share one secret.
 */
function deriveKey(sessionSecret: string, purpose: string): Buffer {
  return scryptSync(sessionSecret, `claude-remote:${purpose}`, 32);
}

/**
 * Encrypts a value for storage. AES-256-GCM, so a tampered ciphertext fails to
 * decrypt rather than decrypting to garbage.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, all base64url.
 */
export function encryptSecret(plaintext: string, sessionSecret: string): string {
  const key = deriveKey(sessionSecret, 'secret-box');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/** Reverses {@link encryptSecret}. Returns null if the value is not intact. */
export function decryptSecret(stored: string, sessionSecret: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const key = deriveKey(sessionSecret, 'secret-box');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, 'base64url')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
