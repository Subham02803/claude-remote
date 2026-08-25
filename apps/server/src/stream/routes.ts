import websocket from '@fastify/websocket';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import * as sessions from '../session/store.js';
import { type Bridge, NoSuchSession, openBridge, parseClientMessage } from '../terminal/bridge.js';
import { isOurs, sessionName, tmuxAvailable } from '../terminal/tmux.js';

/** Session ids we mint and accept. Anything else never reaches tmux. */
const ID = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * The terminal socket.
 *
 * Protocol, deliberately lopsided:
 *   server → client   raw text frames, the terminal's own bytes
 *   client → server   JSON only — {t:'i',d} for input, {t:'r',cols,rows} to resize
 *
 * Keeping the client side structured means a stray keystroke can never be
 * mistaken for a control message, and the server never has to guess.
 */
export async function registerStreamRoutes(
  app: FastifyInstance,
  config: Config,
  db: Database,
): Promise<void> {
  await app.register(websocket);

  const version = await tmuxAvailable();
  if (!version) {
    app.log.error('tmux is not installed, so no terminal can be opened. `brew install tmux`');
  } else {
    app.log.info({ tmux: version }, 'tmux found');
  }

  // The ws server tracks its own clients, and closing Fastify does not close
  // them. Without this, a shutdown waits forever on sockets that will never
  // end by themselves — a terminal never goes idle.
  app.addHook('onClose', async () => {
    for (const client of app.websocketServer.clients) client.terminate();
    app.websocketServer.close();
  });

  app.get<{ Params: { id: string } }>(
    '/api/terminal/:id',
    { websocket: true },
    async (socket, req) => {
      const { id } = req.params;
      if (!ID.test(id) || !isOurs(sessionName(id))) {
        socket.close(1008, 'bad session id');
        return;
      }

      const q = req.query as { cols?: string; rows?: string };
      const cols = Number(q.cols) || 80;
      const rows = Number(q.rows) || 24;

      // The session must already exist, and its project decides the folder.
      // A URL cannot conjure a Claude somewhere unexpected.
      const row = sessions.get(db, id);
      const project = row && config.projects.find((p) => p.id === row.project_id);
      if (!row || !project) {
        socket.close(1008, 'no such session');
        return;
      }

      let bridge: Bridge;
      try {
        bridge = await openBridge({
          id,
          cwd: project.path,
          cols,
          rows,
          onData: (chunk) => {
            if (socket.readyState === socket.OPEN) socket.send(chunk);
          },
          onExit: () => {
            if (socket.readyState === socket.OPEN) socket.close(1000, 'session ended');
          },
        });
      } catch (err) {
        if (err instanceof NoSuchSession) {
          // tmux lost it since the listing; reconcile so the UI stops showing it.
          await sessions.reconcile(db, config, req.log);
          socket.close(1008, 'session is gone');
          return;
        }
        req.log.error({ err, id }, 'could not open a terminal');
        socket.close(1011, 'could not open a terminal');
        return;
      }

      req.log.info({ id, cols, rows }, 'terminal attached');

      socket.on('message', (raw: Buffer) => {
        const msg = parseClientMessage(raw.toString('utf8'));
        if (!msg) return;
        if (msg.t === 'i') bridge.write(msg.d);
        else bridge.resize(msg.cols, msg.rows);
      });

      socket.on('close', () => {
        req.log.info({ id }, 'terminal detached');
        // Detaches; the tmux session and everything in it keeps running.
        bridge.dispose();
      });
    },
  );
}
