import type { FilePreview } from '@claude-remote/shared';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';

type Block =
  | { t: 'h1' | 'h2' | 'p' | 'li' | 'quote'; s: string }
  | { t: 'code'; s: string }
  | { t: 'hr' };

/**
 * Just enough Markdown to read a document on a phone.
 *
 * Block level, plus the three inline marks that actually get in the way when
 * left raw. Deliberately not a full parser: headings, lists, quotes, fenced
 * code and paragraphs are what a scope doc or a report is made of.
 *
 * Nothing here produces HTML. Every block becomes a React element with the
 * text as a child, so a document a session wrote cannot style, script, or
 * escape this page — which is the whole reason it is not a `dangerouslySet`
 * one-liner over a markdown library.
 */
export function parseMarkdown(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split('\n');
  let fence: string[] | null = null;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (fence) {
        out.push({ t: 'code', s: fence.join('\n') });
        fence = null;
      } else {
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push({ t: 'hr' });
    } else if (trimmed.startsWith('#')) {
      const depth = trimmed.match(/^#+/)?.[0].length ?? 1;
      out.push({ t: depth === 1 ? 'h1' : 'h2', s: trimmed.replace(/^#+\s*/, '') });
    } else if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      out.push({ t: 'li', s: trimmed.replace(/^([-*+]|\d+\.)\s+/, '') });
    } else if (trimmed.startsWith('>')) {
      out.push({ t: 'quote', s: trimmed.replace(/^>\s?/, '') });
    } else {
      // Wrapped prose: continue the paragraph rather than starting a new one.
      const last = out[out.length - 1];
      if (last && last.t === 'p') last.s += ` ${trimmed}`;
      else out.push({ t: 'p', s: trimmed });
    }
  }
  // An unterminated fence still has content worth showing.
  if (fence) out.push({ t: 'code', s: fence.join('\n') });
  return out;
}

/**
 * `**bold**`, `*italic*` and `` `code` `` become elements; everything else is
 * left as written.
 *
 * Split on a capturing regex, so the marks come back as their own pieces and
 * the text between them is never re-scanned. The result is React children, not
 * a string — the safety property of the block parser holds here too.
 */
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      const key = `${i}-${part.slice(0, 12)}`;
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return (
          <code className="md__inline" key={key}>
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      return <span key={key}>{part}</span>;
    });
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        if (b.t === 'hr') return <div className="md__hr" key={key} />;
        if (b.t === 'code')
          return (
            <pre className="md__code" key={key}>
              {b.s}
            </pre>
          );
        return (
          <div className={`md__${b.t}`} key={key}>
            {inline(b.s)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Shows one file the way it is meant to be read.
 *
 * The HTML case is the one with teeth. A prototype has to *run* to be worth
 * previewing, so it goes into an iframe with `allow-scripts` — but never with
 * `allow-same-origin`. That combination puts the frame in an opaque origin: its
 * scripts work, and they can reach neither this page's DOM nor its storage.
 *
 * It matters here more than it would in most apps. This server has no sign-in —
 * reaching it is what grants access — so a prototype that could script this
 * origin could drive /api/sessions. Two things stop that: the sandbox above,
 * and the host guard, which already refuses an `Origin: null` request (see
 * `security/guard.ts`, and the test that pins it).
 */
export function Preview({ file, full = false }: { file: FilePreview; full?: boolean }) {
  const box = full ? 'pv pv--full' : 'pv';
  if (file.kind === 'html') {
    return (
      <div className={box}>
        <iframe
          className={`pv__frame${full ? ' pv__frame--full' : ''}`}
          title={`Preview of ${file.path}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={file.text}
        />
      </div>
    );
  }
  if (file.kind === 'md') {
    return (
      <div className={box}>
        <Markdown text={file.text} />
      </div>
    );
  }
  return (
    <div className={box}>
      <pre className="pv__code">{file.text}</pre>
    </div>
  );
}

/**
 * The same preview, filling the screen.
 *
 * Worth its own component rather than a CSS class on the inline one: a 390px
 * frame is not enough to judge a prototype, and on a phone it is most of the
 * decision. Escape closes it, because a full-screen overlay with no keyboard
 * way out is a trap.
 */
export function PreviewFull({ file, onClose }: { file: FilePreview; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // A real <dialog> opened with showModal() rather than a styled div: it lands
  // in the browser's top layer, so no z-index can lose a race with it, and
  // Escape is handled natively — one less thing to get right by hand.
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      className="pv__sheet"
      ref={ref}
      onClose={onClose}
      aria-label={`Preview of ${file.path}`}
    >
      <div className="pv__sheet-bar">
        <span className="kind">{file.kind}</span>
        <span className="mono truncate" style={{ fontSize: 12, flexGrow: 1, minWidth: 0 }}>
          {file.path}
        </span>
        <span className="pv__note">{previewNote(file.kind)}</span>
        <button
          type="button"
          className="btn btn--line btn--sm"
          onClick={() => ref.current?.close()}
        >
          Close
        </button>
      </div>
      <div className="pv__sheet-body">
        <Preview file={file} full />
      </div>
    </dialog>
  );
}

/** The one-line promise made about how the file above is being shown. */
export function previewNote(kind: FilePreview['kind']): string {
  if (kind === 'html') return 'Sandboxed · cannot reach this app';
  if (kind === 'md') return 'Rendered read-only';
  return 'Shown as plain text';
}
