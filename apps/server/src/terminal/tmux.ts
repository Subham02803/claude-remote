import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The bits of tmux we drive.
 *
 * tmux is the session. It is what makes closing a browser, restarting this
 * server, and moving from a phone to a laptop all the same non-event — so it
 * owns durability, and this file is only a thin way to ask it things.
 *
 * `tmux list-sessions` is the source of truth for what exists. Nothing here
 * caches, because a second registry that can disagree is a bug factory.
 */

/** Session names we own. Anything else on the machine is not ours to touch. */
export const PREFIX = 'cr-';

export function sessionName(id: string): string {
  return `${PREFIX}${id}`;
}

/** tmux names cannot contain a dot or colon, and we control the rest. */
export function isOurs(name: string): boolean {
  return name.startsWith(PREFIX) && /^[A-Za-z0-9_-]+$/.test(name);
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await run('tmux', ['has-session', '-t', `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

export interface TmuxSession {
  name: string;
  createdAt: Date;
  attached: boolean;
  windows: number;
}

/** Every session we own, straight from tmux. */
export async function listSessions(): Promise<TmuxSession[]> {
  let stdout: string;
  try {
    ({ stdout } = await run('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}',
    ]));
  } catch {
    // tmux exits non-zero when no server is running, which is not an error.
    return [];
  }
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, created, attached, windows] = line.split('\t');
      return {
        name: name ?? '',
        createdAt: new Date(Number(created ?? 0) * 1000),
        attached: attached !== '0',
        windows: Number(windows ?? 1),
      };
    })
    .filter((s) => isOurs(s.name));
}

/**
 * Creates a detached session running `command` in `cwd`.
 *
 * Detached on purpose: the session has to exist and be working before any
 * browser is looking at it, and has to keep working after every browser
 * has gone.
 */
export async function newSession(input: {
  name: string;
  cwd: string;
  command: string;
}): Promise<void> {
  await run('tmux', [
    'new-session',
    '-d',
    '-s',
    input.name,
    '-c',
    input.cwd,
    // A session whose only window is the command exits when the command does,
    // which is what we want: no stray shell left behind.
    input.command,
  ]);
}

/**
 * Turns on mouse reporting for one session.
 *
 * Without it the wheel never reaches tmux, and the browser scrolls a local
 * buffer that can only ever hold torn pieces of earlier repaints. Idempotent,
 * and scoped to a session we own.
 */
export async function enableMouse(name: string): Promise<void> {
  try {
    await run('tmux', ['set-option', '-t', name, 'mouse', 'on']);
  } catch {
    // Not worth failing an attach over: the terminal still works, it just
    // scrolls badly.
  }
}

export async function killSession(name: string): Promise<void> {
  try {
    await run('tmux', ['kill-session', '-t', `=${name}`]);
  } catch {
    // Already gone is the outcome we wanted.
  }
}

/** True when tmux is installed at all — checked once at boot for a clear error. */
export async function tmuxAvailable(): Promise<string | null> {
  try {
    const { stdout } = await run('tmux', ['-V']);
    return stdout.trim();
  } catch {
    return null;
  }
}
