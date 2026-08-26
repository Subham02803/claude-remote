import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sessionName } from './tmux.js';

const run = promisify(execFile);

/**
 * Writing into a session without being attached to it.
 *
 * `tmux send-keys` reaches the session directly, so the phone does not need a
 * live terminal socket open to answer a question — which is the whole point of
 * the thirty-second unblock.
 *
 * Note the target has no `=` prefix: unlike `has-session` and `kill-session`,
 * `send-keys` takes a *pane* target and rejects the exact-match form.
 */
export async function sendKeys(id: string, keys: string[]): Promise<void> {
  await run('tmux', ['send-keys', '-t', sessionName(id), ...keys]);
}

/**
 * What the answer looks like as keystrokes.
 *
 * Claude Code's permission prompt is a numbered list — `1` approves once, `2`
 * is the broader "don't ask again", and Escape declines. We deliberately never
 * send `2`: pre-approving everything from a phone is the one control that
 * turns a mistap into unrestricted execution.
 */
export const ANSWER = {
  approve: ['1'],
  deny: ['Escape'],
} as const;

/**
 * Picking one option from a numbered question.
 *
 * The digit alone, with no Enter after it: in Claude Code's list a number key
 * both moves to that entry and takes it. An Enter behind it would land on
 * whatever came next — an empty prompt, or the default of the following
 * question — which is the kind of mistake that is invisible from a phone.
 */
export function choose(n: number): string[] {
  return [String(n)];
}

/**
 * Types a prompt into a session and submits it.
 *
 * `-l` sends the text literally, so a prompt containing `C-c` or `Enter` as
 * words is typed rather than interpreted. The Enter goes separately: Claude
 * Code's input does not reliably take text and submit in one call.
 */
export async function sendText(id: string, text: string): Promise<void> {
  await run('tmux', ['send-keys', '-t', sessionName(id), '-l', text]);
  await new Promise((r) => setTimeout(r, 120));
  await run('tmux', ['send-keys', '-t', sessionName(id), 'Enter']);
}
