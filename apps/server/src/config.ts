import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import type { AuthMode } from '@claude-remote/shared';
import { z } from 'zod';

/** Repo root, three levels up from apps/server/src. */
export const repoRoot = resolve(import.meta.dirname, '../../..');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopback(host: string): boolean {
  if (LOOPBACK.has(host)) return true;
  // 127.0.0.0/8 is all loopback, not just .0.1
  return isIP(host) === 4 && host.startsWith('127.');
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4180),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_PATH: z.string().min(1).default('./data/claude-remote.db'),
  AUTH_MODE: z.enum(['google', 'local', 'none']).default('none'),
  SESSION_SECRET: z.string().optional(),
  ALLOWED_EMAIL: z.string().email().optional(),
  PUBLIC_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Absolute path. Its directory is created on boot. */
  databasePath: string;
  authMode: AuthMode;
  sessionSecret: string | null;
  allowedEmail: string | null;
  publicUrl: string | null;
  google: { clientId: string; clientSecret: string } | null;
  /** True when HOST cannot be reached from outside this machine. */
  boundToLoopback: boolean;
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

  // AUTH_MODE=none means anyone who can reach the port is the owner. Only
  // tolerable when the port is unreachable from off-machine.
  if (e.AUTH_MODE === 'none' && !loopback) {
    problems.push(
      `AUTH_MODE=none is only allowed when HOST is a loopback address (got "${e.HOST}"). Set AUTH_MODE=local or google, or bind to 127.0.0.1.`,
    );
  }

  if (e.AUTH_MODE !== 'none') {
    if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32) {
      problems.push(
        `SESSION_SECRET must be at least 32 characters for AUTH_MODE=${e.AUTH_MODE}. Generate one with: openssl rand -base64 48`,
      );
    }
  }

  if (e.AUTH_MODE === 'google') {
    if (!e.GOOGLE_CLIENT_ID) problems.push('GOOGLE_CLIENT_ID is required for AUTH_MODE=google.');
    if (!e.GOOGLE_CLIENT_SECRET) {
      problems.push('GOOGLE_CLIENT_SECRET is required for AUTH_MODE=google.');
    }
    if (!e.ALLOWED_EMAIL) {
      problems.push(
        'ALLOWED_EMAIL is required for AUTH_MODE=google, so exactly one account can sign in.',
      );
    }
    if (!e.PUBLIC_URL) {
      problems.push(
        'PUBLIC_URL is required for AUTH_MODE=google: Google needs one exact redirect URI.',
      );
    }
  }

  if (e.PUBLIC_URL) {
    const url = new URL(e.PUBLIC_URL);
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
      problems.push(`PUBLIC_URL must use https (got "${e.PUBLIC_URL}").`);
    }
    if (e.PUBLIC_URL.endsWith('/')) {
      warnings.push('PUBLIC_URL has a trailing slash; it will be ignored.');
    }
  }

  if (e.AUTH_MODE === 'none') {
    warnings.push('AUTH_MODE=none: no sign-in required. Do not open a tunnel while this is set.');
  }
  if (e.AUTH_MODE !== 'none' && !e.PUBLIC_URL) {
    warnings.push('PUBLIC_URL is not set, so no tunnel URL is known yet.');
  }

  if (problems.length) throw new ConfigError(problems);

  const dbPath = resolve(repoRoot, e.DATABASE_PATH);

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databasePath: dbPath,
    authMode: e.AUTH_MODE,
    sessionSecret: e.SESSION_SECRET ?? null,
    allowedEmail: e.ALLOWED_EMAIL ?? null,
    publicUrl: e.PUBLIC_URL ? e.PUBLIC_URL.replace(/\/+$/, '') : null,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : null,
    boundToLoopback: loopback,
    version: readVersion(),
    warnings,
  };
}

/** Directory the database file lives in; created on boot. */
export function databaseDir(config: Config): string {
  return dirname(config.databasePath);
}
