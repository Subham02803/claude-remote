import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { hostname } from './security/hosts.js';

/** Repo root, three levels up from apps/server/src. */
export const repoRoot = resolve(import.meta.dirname, '../../..');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopback(host: string): boolean {
  if (LOOPBACK.has(host)) return true;
  // 127.0.0.0/8 is all loopback, not just .0.1
  return isIP(host) === 4 && host.startsWith('127.');
}

/** Tailscale hands out addresses from 100.64.0.0/10. */
function isTailscale(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const p = host.split('.').map(Number);
  return p[0] === 100 && p[1]! >= 64 && p[1]! <= 127;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4180),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_PATH: z.string().min(1).default('./data/claude-remote.db'),
  PUBLIC_URL: z.string().url().optional(),
  ALLOWED_HOSTS: z.string().optional(),
  BIND_ANY: z.enum(['true', 'false']).optional(),
  TERMINAL_COMMAND: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Absolute path. Its directory is created on boot. */
  databasePath: string;
  /** The name this server is reached by from other devices, when there is one. */
  publicUrl: string | null;
  /** Extra host names to answer to, beyond loopback and the tailnet. */
  allowedHosts: string[];
  /** True when HOST cannot be reached from outside this machine. */
  boundToLoopback: boolean;
  /** True when the bind-address rule was waived, which only containers should do. */
  bindAny: boolean;
  /** What runs in a session. `bash` is handy for tests that should not burn quota. */
  terminalCommand: string;
  /**
   * The home directory. Every folder a project can live in is under it, and
   * the picker never offers anything else — see projects/browse.ts.
   */
  home: string;
  version: string;
  /** Legal but noteworthy configuration, surfaced at boot and in /api/health/detail. */
  warnings: string[];
}

/** Thrown when configuration is unusable. Carries a list of human-readable problems. */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuration is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

function readVersion(): string {
  try {
    const pkg = readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8');
    return (JSON.parse(pkg) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Validates the environment and returns config, or throws ConfigError listing
 * every problem at once. Booting half-configured is worse than not booting.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `FOO=` in a .env file arrives as an empty string, which means "not set" to
  // a person and "invalid value" to a validator. Drop them before parsing so
  // the defaults apply and optional values stay optional.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  const loopback = isLoopback(e.HOST);

  // There is no sign-in, so whoever can reach the port is the owner. The only
  // two places that is true of the right people are this machine and the
  // tailnet. Binding anywhere else — 0.0.0.0 above all — would put an
  // unauthenticated door on the local network.
  //
  // BIND_ANY is the one exception, and it exists for containers: inside a
  // container 0.0.0.0 is only the container's own namespace, and what actually
  // decides exposure is the port mapping on the outside. Setting this on the
  // host is exactly the mistake the rule above is here to prevent.
  const bindAny = e.BIND_ANY === 'true';
  if (!loopback && !isTailscale(e.HOST) && !bindAny) {
    problems.push(
      `HOST must be a loopback address or this machine's Tailscale address (got "${e.HOST}"). There is no sign-in, so binding anywhere else exposes an unauthenticated server. Use 127.0.0.1 and reach it with "tailscale serve", or bind directly to your 100.x.y.z address. (Inside a container, set BIND_ANY=true and publish the port to 127.0.0.1 on the host.)`,
    );
  }
  if (bindAny && !loopback && !isTailscale(e.HOST)) {
    warnings.push(
      `BIND_ANY=true: listening on ${e.HOST} with no sign-in. Only safe if something outside this process limits who can reach the port — a container publishing to 127.0.0.1, or a firewall.`,
    );
  }

  if (e.PUBLIC_URL) {
    const url = new URL(e.PUBLIC_URL);
    if (e.PUBLIC_URL.endsWith('/')) {
      warnings.push('PUBLIC_URL has a trailing slash; it will be ignored.');
    }
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
      warnings.push(
        `PUBLIC_URL is not https, so browsers will treat it as an insecure context. Passkeys, service workers and web push will not work over "${url.protocol}//".`,
      );
    }
  }

  // Projects are not configured here any more. They live in the database,
  // grouped into workspaces, and are added from the UI — see projects/store.ts.
  // The rule that made a declared list worth having is unchanged: a session can
  // only start in a folder someone named on purpose.

  if (problems.length) throw new ConfigError(problems);

  const extraHosts = (e.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => hostname(h));
  if (e.PUBLIC_URL) extraHosts.push(hostname(new URL(e.PUBLIC_URL).host));

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databasePath: resolve(repoRoot, e.DATABASE_PATH),
    publicUrl: e.PUBLIC_URL ? e.PUBLIC_URL.replace(/\/+$/, '') : null,
    allowedHosts: [...new Set(extraHosts)],
    boundToLoopback: loopback,
    bindAny,
    terminalCommand: e.TERMINAL_COMMAND ?? 'claude',
    home: homedir(),
    version: readVersion(),
    warnings,
  };
}

/** Directory the database file lives in; created on boot. */
export function databaseDir(config: Config): string {
  return dirname(config.databasePath);
}
