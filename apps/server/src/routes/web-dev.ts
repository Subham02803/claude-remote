import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server } from 'node:http';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { InlineConfig } from 'vite';
import { type Config, repoRoot } from '../config.js';
import { makeHostAllowed } from '../security/hosts.js';

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The sub-protocol Vite's HMR client asks for. Nothing else uses it. */
const HMR_PROTOCOL = 'vite-hmr';

/**
 * Runs the web app's Vite dev server inside this process, on this port.
 *
 * The alternative — Vite listening on 5173 next door — gives you two addresses
 * that both look like the app, and the wrong one is whatever `apps/web/dist`
 * was built from last. One origin also means one host allowlist, one
 * `tailscale serve`, and no proxy hop for the terminal socket. Dev and
 * production then differ in how the assets are produced, not in where they are.
 */
export async function attachDevWebApp(
  app: FastifyInstance,
  config: Config,
  isApiUrl: (url: string) => boolean,
): Promise<void> {
  // Read back in apps/web/vite.config.ts: embedded, there is no separate port
  // to listen on and nothing to proxy to, because the API is this server.
  process.env.CLAUDE_REMOTE_EMBEDDED = '1';
  const { createServer } = await import('vite');

  // The config is imported rather than handed to Vite as `configFile`. Vite
  // loads a config by bundling it to a `.timestamp-*.mjs` beside it and
  // deleting that again, and the delete is a file event `tsx watch` restarts
  // on — which restarts this server, which loads the config, forever. tsx
  // already reads TypeScript, so importing it directly costs nothing and has
  // the bonus that editing the config restarts the server like any other file.
  // The specifier is built rather than literal so tsc treats it as external.
  const configPath = pathToFileURL(resolve(repoRoot, 'apps/web/vite.config.ts')).href;
  const loaded = ((await import(configPath)) as { default: unknown }).default;
  const webConfig = (
    typeof loaded === 'function' ? await loaded({}) : await loaded
  ) as InlineConfig;

  // Vite only ever calls `.on('upgrade')` on whatever it is handed here, and
  // this server's upgrades are dispatched below rather than by Node directly —
  // so an emitter is the whole contract.
  const hmr = new EventEmitter();

  const vite = await createServer({
    ...webConfig,
    configFile: false,
    root: resolve(repoRoot, 'apps/web'),
    appType: 'spa',
    server: {
      ...webConfig.server,
      middlewareMode: true,
      hmr: { server: hmr as unknown as Server },
    },
  });
  app.addHook('onClose', async () => {
    await vite.close();
  });

  // Two websocket servers now share one port: HMR and the terminal. Fastify's
  // plugin answers every upgrade by routing it, and a route miss destroys the
  // socket — so HMR has to be picked off before that runs. onReady, because by
  // then every plugin has attached whatever listener it wanted.
  const allowed = makeHostAllowed(config.allowedHosts);
  app.addHook('onReady', function onReady(done) {
    const server = this.server;
    const rest = server.listeners('upgrade') as UpgradeListener[];
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
      if (req.headers['sec-websocket-protocol'] !== HMR_PROTOCOL) {
        for (const listener of rest) listener.call(server, req, socket, head);
        return;
      }
      // The host guard never sees this one: it is answered before routing.
      // Same rule, applied here rather than skipped.
      if (!allowed(req.headers.host ?? '')) {
        app.log.warn({ host: req.headers.host }, 'rejected an HMR socket naming an unknown host');
        socket.destroy();
        return;
      }
      hmr.emit('upgrade', req, socket, head);
    });
    done();
  });

  // API routes belong to Fastify; everything else is the web app, which in
  // development means Vite — modules, assets, HMR client and index.html alike.
  app.addHook('onRequest', (req, reply, done) => {
    if (isApiUrl(req.url)) {
      done();
      return;
    }
    // Fastify is out of this request from here: Vite writes the response.
    reply.hijack();
    vite.middlewares(req.raw, reply.raw, (err?: unknown) => {
      if (err) {
        app.log.error({ err, url: req.url }, 'Vite could not serve this');
        reply.raw.statusCode = 500;
      } else {
        reply.raw.statusCode = 404;
      }
      reply.raw.end();
    });
  });
}
