import { isIP } from 'node:net';

/**
 * Which names this server will answer to.
 *
 * There is no sign-in. The gate is the network: the server binds somewhere only
 * trusted devices can reach, and Tailscale decides who those devices are. That
 * covers every attacker on the wire, but it does not cover one case — a request
 * that the owner's own browser is tricked into making.
 *
 * DNS rebinding is the attack. A page on evil.com re-resolves its own name to
 * 127.0.0.1 (or to a tailnet address) and then scripts requests at this server.
 * The packets genuinely come from a trusted device, so no network rule can help.
 * What gives it away is the name: the browser still says `Host: evil.com`.
 *
 * So this checks the name in the request, never the address it arrived from.
 * That distinction is the whole point — it means the check costs nothing in
 * reach. Any device that can route to the server still works, including ones
 * added later, because a device is not what is being judged.
 */

/** Tailscale hands out addresses from 100.64.0.0/10. */
function isTailscaleAddress(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const parts = host.split('.').map(Number);
  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

function isLoopbackAddress(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  return isIP(host) === 4 && host.startsWith('127.');
}

/**
 * Strips the port and any IPv6 brackets from a Host header.
 *
 * `[::1]:4180` and `127.0.0.1:4180` and `example.ts.net` all have to end up as
 * something comparable, and only the last colon can be a port separator.
 */
export function hostname(headerValue: string): string {
  const value = headerValue.trim().toLowerCase();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value.slice(1) : value.slice(1, close);
  }
  const colon = value.lastIndexOf(':');
  // A bare IPv6 address has several colons and no port; leave it alone.
  if (colon === -1 || value.indexOf(':') !== colon) return value;
  return value.slice(0, colon);
}

/**
 * Builds the test used for every request.
 *
 * Loopback, the Tailscale range and MagicDNS names are allowed by default so
 * that adding a device to the tailnet needs no configuration here. `extra`
 * carries anything else, from ALLOWED_HOSTS and PUBLIC_URL.
 */
export function makeHostAllowed(extra: readonly string[]): (candidate: string) => boolean {
  const explicit = new Set(extra.map((h) => hostname(h)));
  return (candidate: string): boolean => {
    const host = hostname(candidate);
    if (!host) return false;
    if (explicit.has(host)) return true;
    if (isLoopbackAddress(host)) return true;
    if (isTailscaleAddress(host)) return true;
    // MagicDNS names, e.g. subhams-mac-mini.tail7b6b35.ts.net
    return host === 'ts.net' || host.endsWith('.ts.net');
  };
}
