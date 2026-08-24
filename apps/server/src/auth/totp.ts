import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'claude-remote';

// One step either side of now. Covers a phone whose clock has drifted a little
// without meaningfully widening the window for guessing.
const WINDOW = 1;

function build(secretBase32: string, account: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: account,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** A fresh base32 secret, 20 bytes as RFC 4226 recommends. */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUrl(secretBase32: string, account: string): string {
  return build(secretBase32, account).toString();
}

/** That same URI as a QR code, inline, so no image has to be served. */
export async function otpauthQr(secretBase32: string, account: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl(secretBase32, account), {
    margin: 1,
    width: 240,
    color: { dark: '#e8eaed', light: '#0e1014' },
  });
}

/**
 * Checks a code. Whitespace is stripped because authenticator apps display
 * codes as "123 456" and people copy them that way.
 */
export function verifyTotp(code: string, secretBase32: string, account: string): boolean {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  return build(secretBase32, account).validate({ token: cleaned, window: WINDOW }) !== null;
}
