import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { type Db, openDatabase } from '../db/index.js';
import { allProjects, seedWorkspaces } from '../projects/store.js';
import { create as createSession } from '../session/store.js';
import { killSession, sessionName } from '../terminal/tmux.js';

/**
 * Rule R1 from docs/02-security-model.md.
 *
 * The host guard is a global `onRequest` hook, which covers every HTTP route
 * automatically. Whether it also runs on a WebSocket *upgrade* depends on how
 * the plugin is wired, and the answer is not obvious — `SameSite` does not
 * protect handshakes and WebSocket has no CORS, so a socket that skips the
 * check is reachable from any page the browser happens to be on.
 *
 * This socket carries a terminal. If the check does not run, a web page gets a
 * shell. That is why this file was written before the socket worked.
 */
describe('R1: the host guard runs on the WebSocket upgrade', () => {
  let app: FastifyInstance;
  let db: Db;
  let port: number;
  const dbPath = join(tmpdir(), `cr-test-${process.pid}-${Date.now()}.db`);
  let TEST_ID: string;

  before(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      // PORT is omitted: the config schema requires a real port, and the test
      // listens on an ephemeral one below anyway.
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: dbPath,
      // bash, not claude: these tests open real tmux sessions and should not
      // spend subscription quota to prove a header check works.
      TERMINAL_COMMAND: 'bash',
    });
    const quiet = { debug() {}, info() {}, warn() {}, error() {} };
    db = openDatabase(config, quiet);
    // Projects live in the database now, so the default workspace has to exist
    // before a session can be started in one. buildApp does this too; this test
    // creates its session before the app is built.
    seedWorkspaces(db.handle, config, quiet, {});
    // Sessions are created deliberately, never by connecting, so make one.
    const created = await createSession(db.handle, config, {
      projectId: allProjects(db.handle)[0]!.id,
      title: 'origin test',
    });
    TEST_ID = created.id;
    app = await buildApp({ config, db, startedAt: Date.now(), quiet: true });
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as { port: number }).port;
  });

  after(async () => {
    // Only sockets that actually opened can be terminated; the refused ones
    // never left CONNECTING and were cleaned up where they were refused.
    for (const ws of opened) {
      if (ws.readyState === WebSocket.OPEN) ws.terminate();
    }
    await app.close();
    db.close();
    // The tests really do create tmux sessions; leaving them behind would
    // slowly fill the machine with orphans named after old test runs.
    await killSession(sessionName(TEST_ID));
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(dbPath + suffix, { force: true });
    }
  });

  /** Every socket opened by a test, so `after` can tear them all down. */
  const opened: WebSocket[] = [];

  /** Resolves to 'open' or the HTTP status the upgrade was refused with. */
  function connect(
    headers: Record<string, string>,
    path = `/api/terminal/${TEST_ID}`,
  ): Promise<'open' | number> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
      opened.push(ws);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('the upgrade neither opened nor was refused'));
      }, 4000);
      const settle = (v: 'open' | number) => {
        clearTimeout(timer);
        ws.removeAllListeners();
        resolve(v);
      };
      // A refused upgrade never becomes a WebSocket: it is still CONNECTING, so
      // both close() and terminate() throw on it. Destroy the underlying
      // request instead, and drain the response or the suite never exits.
      ws.on('unexpected-response', (req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        req.destroy();
        settle(status);
      });
      ws.on('open', () => settle('open'));
      ws.on('error', (err) => {
        clearTimeout(timer);
        ws.removeAllListeners();
        reject(err);
      });
    });
  }

  it('accepts loopback', async () => {
    assert.equal(await connect({ host: `127.0.0.1:${port}` }), 'open');
  });

  it('accepts a tailnet address', async () => {
    assert.equal(await connect({ host: '100.109.114.92:4180' }), 'open');
  });

  it('accepts a MagicDNS name, including a device added later', async () => {
    assert.equal(await connect({ host: 'some-new-laptop.tail7b6b35.ts.net' }), 'open');
  });

  it('REFUSES a rebound host — the attack this exists to stop', async () => {
    assert.equal(await connect({ host: 'evil.com' }), 403);
  });

  it('REFUSES a foreign Origin even when the Host looks fine', async () => {
    assert.equal(await connect({ host: `127.0.0.1:${port}`, origin: 'https://evil.com' }), 403);
  });

  it('REFUSES a null Origin (sandboxed iframe, file://)', async () => {
    assert.equal(await connect({ host: `127.0.0.1:${port}`, origin: 'null' }), 403);
  });

  it('REFUSES a host that merely ends up looking like a tailnet name', async () => {
    assert.equal(await connect({ host: 'evil.ts.net.attacker.com' }), 403);
  });

  it('holds two sockets on the same session at once', async () => {
    const [a, b] = await Promise.all([
      connect({ host: `127.0.0.1:${port}` }),
      connect({ host: `127.0.0.1:${port}` }),
    ]);
    assert.equal(a, 'open');
    assert.equal(b, 'open');
  });
});
