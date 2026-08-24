import type { Health, HealthDetail } from '@claude-remote/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  startedAt: number,
): void {
  const uptime = () => Math.round((Date.now() - startedAt) / 1000);

  // Liveness. Says the process is alive and nothing more.
  app.get(
    '/api/health',
    async (): Promise<Health> => ({
      ok: true,
      name: 'claude-remote',
      version: config.version,
      uptimeSeconds: uptime(),
    }),
  );

  // Diagnostics. Reachable by anything that reaches the server at all, which is
  // this machine and the tailnet — deliberately, since there is no sign-in to
  // put it behind. Note that a loopback check would not narrow it: under
  // `tailscale serve` every request arrives from 127.0.0.1, so such a check
  // would pass for the whole tailnet while reading as though it did not.
  // Keep genuinely sensitive values out of this response instead.
  app.get('/api/health/detail', async (): Promise<HealthDetail> => {
    return {
      ok: true,
      name: 'claude-remote',
      version: config.version,
      uptimeSeconds: uptime(),
      publicUrl: config.publicUrl,
      bind: { host: config.host, port: config.port },
      allowedHosts: config.allowedHosts,
      database: { migrationsApplied: db.migrationsApplied },
      warnings: config.warnings,
    };
  });
}
