import { spawn } from 'node-pty';
import type { IPty } from 'node-pty';
import { hasSession, sessionName } from './tmux.js';

/**
 * One browser's view of one tmux session.
 *
 * A bridge is deliberately cheap and disposable: it is a `tmux attach` running
 * in a pseudo-terminal, nothing more. Closing it detaches; it does not stop
 * anything. Everything that matters lives in tmux on the other side.
 */
export interface Bridge {
  readonly pty: IPty;
  resize(cols: number, rows: number): void;
  write(data: string): void;
  dispose(): void;
}

/** What a client is allowed to send us. Anything else is dropped. */
export type ClientMessage = { t: 'i'; d: string } | { t: 'r'; cols: number; rows: number };

export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.t === 'i' && typeof m.d === 'string') return { t: 'i', d: m.d };
  if (m.t === 'r' && Number.isInteger(m.cols) && Number.isInteger(m.rows)) {
    // Clamp: a client can send anything, and tmux does unhelpful things with
    // absurd geometry.
    const cols = Math.min(Math.max(m.cols as number, 20), 500);
    const rows = Math.min(Math.max(m.rows as number, 5), 300);
    return { t: 'r', cols, rows };
  }
  return null;
}

export class NoSuchSession extends Error {}

/**
 * Attaches to an existing session.
 *
 * It never creates one. Sessions are started deliberately, through the store,
 * so that a typo in a URL cannot quietly spawn a Claude in an unexpected
 * folder. The attach is always `tmux attach`, never `claude` directly: if this
 * process spawned the command itself, the work would die with the socket.
 */
export async function openBridge(input: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  onData: (chunk: string) => void;
  onExit: () => void;
}): Promise<Bridge> {
  const name = sessionName(input.id);
  if (!(await hasSession(name))) {
    throw new NoSuchSession(`No tmux session for "${input.id}".`);
  }

  const pty = spawn('tmux', ['attach', '-t', `=${name}`], {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: process.env as Record<string, string>,
  });

  pty.onData(input.onData);
  pty.onExit(input.onExit);

  let disposed = false;
  return {
    pty,
    resize(cols, rows) {
      if (disposed) return;
      try {
        pty.resize(cols, rows);
      } catch {
        // The pty can go away between a client's resize and this call.
      }
    },
    write(data) {
      if (disposed) return;
      pty.write(data);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Detach cleanly first (Ctrl-B d) so tmux keeps the session alive, then
      // make sure the client process is gone.
      try {
        pty.write('\x02d');
      } catch {
        // Already dead; killing below is still correct.
      }
      setTimeout(() => {
        try {
          pty.kill();
        } catch {
          // Nothing to do — the point was that it is not running.
        }
      }, 50);
    },
  };
}
