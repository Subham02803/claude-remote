import { isIP } from 'node:net';
import type { Health, HealthDetail } from '@claude-remote/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

function fromLoopback(ip: string): boolean {
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (bare === '::1' || bare === 'localhost') return true;
  return isIP(bare) === 4 && bare.startsWith('127.');
}

export function registerHealthRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  startedAt: number,
): void {
  const uptime = () => Math.round((Date.now() - startedAt) / 1000);

  // Public. Says the process is alive and nothing more: once a tunnel is open,
  // this endpoint is on the internet.
  app.get(
    '/api/health',
    async (): Promise<Health> => ({
      ok: true,
      name: 'claude-remote',
      version: config.version,
      uptimeSeconds: uptime(),
    }),
  );

  // Diagnostics. Loopback-only for now; moves behind authentication in step 1,
  // at which point the loopback check becomes a fallback rather than the gate.
  app.get('/api/health/detail', async (req, reply) => {
    if (!fromLoopback(req.ip)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Diagnostics are only served to this machine.',
      });
    }
    const body: HealthDetail = {
      ok: true,
      name: 'claude-remote',
      version: config.version,
      uptimeSeconds: uptime(),
      authMode: config.authMode,
      publicUrl: config.publicUrl,
      bind: { host: config.host, port: config.port },
      database: { path: config.databasePath, migrationsApplied: db.migrationsApplied },
      warnings: config.warnings,
    };
    return body;
  });
}
