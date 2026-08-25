import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';

/**
 * Hook events we ask Claude Code to tell us about.
 *
 * Deliberately short. Every one of these drives something visible; anything we
 * would not display, we do not ask for.
 */
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;

/**
 * Where a session's generated settings live. One file per session, so the hook
 * URL can carry our own session id.
 *
 * That is the whole trick: `cwd` is not a unique key — two sessions can run in
 * the same folder, and scope UC-10 wants exactly that — so instead of
 * correlating events after the fact, we tell each Claude which session it is
 * when we start it.
 */
export function settingsPath(config: Config, id: string): string {
  return join(dirname(config.databasePath), 'hooks', `${id}.json`);
}

/**
 * Writes the settings file Claude Code is launched with.
 *
 * `type: "command"` rather than `type: "http"`, and not by preference:
 * **SessionStart never fires over http** (verified repeatedly), while command
 * hooks fire for every event. Two transports would mean two failure modes, so
 * everything goes through one.
 */
export function writeHookSettings(config: Config, id: string): string {
  const path = settingsPath(config, id);
  mkdirSync(dirname(path), { recursive: true });

  const url = `http://127.0.0.1:${config.port}/api/hooks/${id}`;
  // Hook payloads arrive on stdin; --data-binary @- forwards them untouched.
  // Failures are swallowed: a hook that cannot reach us must never be the
  // reason someone's session stalls.
  const command = `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- '${url}' > /dev/null 2>&1 || true`;

  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 5 }] }];
  }

  writeFileSync(path, JSON.stringify({ hooks }, null, 2), 'utf8');
  return path;
}
