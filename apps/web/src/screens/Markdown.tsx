import type { ReactNode } from 'react';

/**
 * Just enough Markdown.
 *
 * Claude writes in a small, predictable subset — headings, bold, inline code,
 * fences, bullets — and rendering that subset well is worth more than pulling a
 * parser and a sanitiser into an app that has neither. Nothing here produces
 * HTML from the input: every branch returns React elements, so a message can
 * never inject markup.
 */

/** `code`, **bold**, *italic* — in one pass, so nesting cannot mis-nest. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Ordered by precedence: code first, so `**` inside a span stays literal.
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null = pattern.exec(text);
  let n = 0;

  while (m) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${n++}`;
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="md__code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      // Recurse: bold routinely wraps a path in backticks, and slicing the
      // markers off without re-parsing leaves the backticks on screen.
      out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    }
    last = m.index + tok.length;
    m = pattern.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Block {
  kind: 'p' | 'h' | 'ul' | 'ol' | 'code';
  level?: number;
  lines: string[];
  lang?: string;
}

/** Groups lines into blocks. Blank lines separate paragraphs; fences win over everything. */
function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence, or the end of the text
      out.push({ kind: 'code', lines: body, lang });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: 'h', level: heading[1]?.length ?? 1, lines: [heading[2] ?? ''] });
      i++;
      continue;
    }

    const bullet = /^\s*[-*]\s+/.test(line);
    const numbered = /^\s*\d+[.)]\s+/.test(line);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const isItem = bullet ? /^\s*[-*]\s+/.test(l) : /^\s*\d+[.)]\s+/.test(l);
        if (!isItem) break;
        items.push(l.replace(bullet ? /^\s*[-*]\s+/ : /^\s*\d+[.)]\s+/, ''));
        i++;
      }
      out.push({ kind, lines: items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (!l.trim() || l.startsWith('```') || /^#{1,4}\s/.test(l)) break;
      if (/^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) break;
      para.push(l);
      i++;
    }
    out.push({ kind: 'p', lines: para });
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        const key = `b${i}`;
        if (b.kind === 'code') {
          return (
            <pre key={key} className="md__block">
              {b.lang && <span className="md__lang">{b.lang}</span>}
              <code>{b.lines.join('\n')}</code>
            </pre>
          );
        }
        if (b.kind === 'h') {
          const Tag = (['h3', 'h4', 'h5', 'h5'][(b.level ?? 1) - 1] ?? 'h5') as 'h3' | 'h4' | 'h5';
          return (
            <Tag key={key} className={`md__h md__h--${b.level}`}>
              {inline(b.lines[0] ?? '', key)}
            </Tag>
          );
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          const Tag = b.kind;
          return (
            <Tag key={key} className="md__list">
              {b.lines.map((li, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: list order is the identity
                <li key={`${key}-${j}`}>{inline(li, `${key}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={key} className="md__p">
            {inline(b.lines.join('\n'), key)}
          </p>
        );
      })}
    </div>
  );
}
