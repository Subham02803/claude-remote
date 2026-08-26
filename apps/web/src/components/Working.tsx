import { useEffect, useState } from 'react';

/**
 * The "Claude is thinking" line.
 *
 * A prompt sent from a phone goes quiet: the transcript is polled every three
 * seconds, and until Claude has said its first word there is nothing to poll —
 * so the chat sits exactly as still as it does when the connection has died.
 * This is the line that tells the two apart.
 *
 * It borrows the terminal's manners on purpose. The rotating word is Claude
 * Code's own trick and it earns its keep twice over: a word that changes is
 * proof the page is still alive, and it is the one part of waiting that anyone
 * has ever enjoyed. The parts that carry actual information — what tool is
 * running, how long this has taken — sit next to it in the same line.
 */

/** Gerunds only, and none of them claiming to know what Claude is doing. */
const WORDS = [
  'Noodling',
  'Pondering',
  'Percolating',
  'Musing',
  'Ruminating',
  'Cogitating',
  'Deliberating',
  'Simmering',
  'Brewing',
  'Marinating',
  'Puzzling',
  'Conjuring',
  'Whirring',
  'Tinkering',
  'Mulling',
  'Churning',
  'Distilling',
  'Untangling',
  'Considering',
  'Computing',
  'Hatching',
  'Sculpting',
  'Concocting',
  'Divining',
  'Forging',
  'Honing',
  'Wrangling',
  'Spelunking',
  'Finagling',
  'Rummaging',
  'Scheming',
  'Beavering',
  'Pottering',
  'Chewing it over',
  'Doing the thinking',
  'Working it out',
];

/** Never the same word twice running — a frozen word reads as a frozen page. */
function anotherWord(not?: string): string {
  for (;;) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)] as string;
    if (word !== not) return word;
  }
}

/** The terminal's asterisk, spun by hand. */
const GLYPHS = ['✳', '✶', '✷', '✸', '✹', '✺'];

/** Seconds while it is still short enough to read as a number. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  return `${mins}m ${String(total % 60).padStart(2, '0')}s`;
}

/** Asked once: a person does not change their mind about this mid-wait. */
const STILL =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Working({ since, doing }: { since: number; doing: string | null }) {
  const [word, setWord] = useState(() => anotherWord());
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Two clocks rather than one: a word that changed exactly every fourth
  // second would tell you it was a loop.
  useEffect(() => {
    const t = setInterval(() => setWord((w) => anotherWord(w)), 3800);
    return () => clearInterval(t);
  }, []);

  // The clock still has to run when motion is turned down — the spinning does
  // not. Nothing else on the line moves, so the seconds become the proof.
  useEffect(() => {
    const t = setInterval(
      () => {
        if (!STILL) setTick((n) => n + 1);
        setNow(Date.now());
      },
      STILL ? 1000 : 240,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <output className="working">
      {/* One stable sentence for a screen reader, said once when the line
          appears. Reading out a new whimsical gerund every four seconds, and a
          clock four times a second, would be an unusable joke. */}
      <span className="sr-only">Claude is working.</span>
      <span className="working__face" aria-hidden="true">
        <span className="working__glyph">{GLYPHS[tick % GLYPHS.length]}</span>
        <span className="working__word">{word}…</span>
        {doing && <span className="working__doing truncate">{doing}</span>}
        <span className="working__time mono num">{elapsed(now - since)}</span>
      </span>
    </output>
  );
}
