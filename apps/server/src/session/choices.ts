import type { AskChoice } from '@claude-remote/shared';

/**
 * Reading the options out of an `AskUserQuestion`.
 *
 * The tool is not a permission prompt, and treating it as one is a bug you can
 * see from across the room: the terminal shows a numbered list of routes —
 * "fix the code", "show me the diff first", "leave it failing" — while the
 * browser shows Approve and Deny. Approve types `1`, which picks whichever
 * option happened to be first. That is not an answer anyone gave.
 *
 * So the input is kept whole by the hook and parsed here, and the browser
 * offers the same list the terminal does.
 *
 * Defensive throughout: this is Claude Code's payload shape, not ours, and a
 * question we cannot read must degrade to the old Approve/Deny rather than
 * throw inside a session listing.
 */

/** The tool this applies to. Everything else is an approval. */
export const CHOICE_TOOL = 'AskUserQuestion';

interface RawOption {
  label?: unknown;
  description?: unknown;
}

interface RawQuestion {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The question a session is blocked on, or null when it is an ordinary ask.
 *
 * Only the first question is returned. Claude Code asks a multi-question call
 * one screen at a time, and the hook fires once for the whole call, so the
 * ones after it are answered where they appear — `more` says how many those
 * are, and the screen says so.
 */
export function parseChoice(tool: string, detail: string): AskChoice | null {
  if (tool !== CHOICE_TOOL) return null;

  let input: unknown;
  try {
    input = JSON.parse(detail);
  } catch {
    // An older row, stored back when this was summarised and truncated.
    return null;
  }
  if (typeof input !== 'object' || input === null) return null;

  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const first = questions[0] as RawQuestion;
  const raw = Array.isArray(first.options) ? (first.options as RawOption[]) : [];

  // Numbered as the terminal numbers them: 1-based, in the order given. The
  // entries it adds of its own ("Type something", "Chat about this") come
  // after these, so our numbers hold whether or not they are there.
  const options = raw
    .filter((o): o is RawOption => typeof o === 'object' && o !== null)
    .map((o, i) => ({ n: i + 1, label: str(o.label), description: str(o.description) }))
    .filter((o) => o.label !== '');

  if (!options.length) return null;

  return {
    question: str(first.question),
    header: str(first.header),
    options,
    multiSelect: first.multiSelect === true,
    more: questions.length - 1,
  };
}
