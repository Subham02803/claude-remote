import type { FileEdit } from '@claude-remote/shared';

/**
 * One edit, shown as what it replaced and what replaced it.
 *
 * Not a computed diff. The hook hands us the two sides the tool was given, so
 * showing them is the honest thing — and cheaper than an LCS nobody asked for.
 * `Write` has no "before" (the tool never sends one), so it is labelled as a
 * write rather than dressed up as a replacement of nothing.
 */
function lines(text: string, sign: '+' | '-') {
  return text.split('\n').map((line, i) => (
    <div
      className={`diff__line diff__line--${sign === '+' ? 'add' : 'del'}`}
      // Line number and content both repeat across a file; the index is the
      // only stable identity a plain text line has here.
      key={`${sign}-${i}-${line.slice(0, 16)}`}
    >
      <span className="diff__n">{i + 1}</span>
      <span className="diff__s">{`${sign} ${line}`}</span>
    </div>
  ));
}

export function Diff({ edits }: { edits: FileEdit[] }) {
  if (edits.length === 0) {
    return (
      <div className="pv">
        <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
          The hook recorded this file as touched but kept no before/after for it.
        </span>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 0 }}>
      {edits.map((e, i) => (
        <div key={`${e.at}-${i}`}>
          <div className="diff__head">
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
              {e.before === null ? `${e.tool} · whole file written` : `${e.tool} · replaced`}
            </span>
            <span className="spacer" />
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {e.at}
            </span>
          </div>
          {/* A payload can name a file and carry neither side — a tool we do
              not know the shape of, or a trimmed hook. Say that, rather than
              rendering an empty strip that reads as a broken diff. */}
          {e.before === null && e.after === null ? (
            <div className="diff__more">The hook recorded this edit without its content.</div>
          ) : (
            <div className="diff">
              {e.before !== null && lines(e.before, '-')}
              {e.after !== null && lines(e.after, '+')}
            </div>
          )}
          {e.truncated && (
            <div className="diff__more">
              Cut at 400 lines — open it in Preview to read the whole file.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
