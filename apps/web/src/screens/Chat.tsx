import type { ChatBlock, ChatMessage } from '@claude-remote/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Markdown } from './Markdown.js';

/**
 * The conversation, as a conversation.
 *
 * Read from Claude Code's transcript rather than scraped off the terminal, so
 * it starts at the first prompt however long ago that was, and so a tool call
 * can be shown as a tool call — collapsed to one line you can skim, opened only
 * when you care. The terminal is still there for the times only a real TUI will
 * do; this is for reading.
 */

/** A path is more useful from the right; a command from the left. */
function trim(text: string, keepEnd: boolean, max = 90): string {
  const line = text.split('\n')[0] ?? '';
  if (line.length <= max) return line;
  return keepEnd ? `…${line.slice(-max)}` : `${line.slice(0, max)}…`;
}

const PATHY = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);

function ToolCall({ block }: { block: Extract<ChatBlock, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const hasBody = Boolean(block.result?.trim());

  return (
    <div className={`tool ${block.ok ? '' : 'tool--failed'}`}>
      <button
        type="button"
        className="tool__head"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasBody}
        aria-expanded={open}
      >
        <span className="tool__caret" aria-hidden="true">
          {hasBody ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className="tool__name">{block.name}</span>
        <span className="tool__summary">{trim(block.summary, PATHY.has(block.name))}</span>
        {block.result === null && <span className="tool__running">running</span>}
        {!block.ok && <span className="tool__failed">failed</span>}
      </button>
      {open && hasBody && (
        <pre className="tool__body">
          {block.result}
          {block.truncated && <span className="tool__cut">… cut. Full output is in Files.</span>}
        </pre>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button type="button" className="thinking__head" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} thought for a moment
      </button>
      {open && <div className="thinking__body">{text}</div>}
    </div>
  );
}

function Message({ msg }: { msg: ChatMessage }) {
  const when = msg.at
    ? new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <article className={`msg msg--${msg.role}`}>
      <header className="msg__head">
        <span className="msg__who">{msg.role === 'user' ? 'You' : 'Claude'}</span>
        {when && <time className="msg__when">{when}</time>}
      </header>
      <div className="msg__body">
        {msg.blocks.map((block, i) => {
          if (block.kind === 'text') {
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
            return <Markdown key={i} text={block.text} />;
          }
          if (block.kind === 'thinking') {
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
            return <Thinking key={i} text={block.text} />;
          }
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
          return <ToolCall key={i} block={block} />;
        })}
      </div>
    </article>
  );
}

export function Chat({ sessionId, live }: { sessionId: string; live: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [found, setFound] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const foot = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const t = await api.transcript(sessionId);
        if (stop) return;
        setMessages(t.messages);
        setFound(t.found);
        setError(null);
      } catch (err) {
        if (!stop)
          setError(err instanceof Error ? err.message : 'Could not read the conversation.');
      }
    };
    void pull();
    // Only while the session can still say something new.
    const timer = live ? setInterval(() => void pull(), 3000) : null;
    return () => {
      stop = true;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, live]);

  // Follow the end as it grows, but never yank the view while you are reading
  // further up — the first thing a chat pane usually gets wrong.
  //
  // Counted in blocks, not messages: one turn grows by tool calls for minutes
  // at a time without the message count moving at all.
  useEffect(() => {
    if (!messages) return;
    const total = messages.reduce((n, m) => n + m.blocks.length, 0);
    const first = count.current === 0;
    const grew = total > count.current;
    count.current = total;
    if (!grew) return;
    const box = foot.current?.parentElement;
    if (!box) return;
    // On first load land at the newest; after that only follow if you were
    // already near the end.
    const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    if (first || nearEnd) foot.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.sendPrompt(sessionId, text);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="chat">
        {error && <p className="chat__note chat__note--bad">{error}</p>}
        {messages === null && !error && <p className="chat__note">Reading the conversation…</p>}
        {messages !== null && !found && (
          <p className="chat__note">
            No transcript yet. Claude files one a moment after a session starts — until then the
            Terminal tab is the live view.
          </p>
        )}
        {messages !== null && found && messages.length === 0 && (
          <p className="chat__note">Nothing said yet. Send the first prompt below.</p>
        )}
        {messages?.map((m) => (
          <Message key={m.id} msg={m} />
        ))}
        <div ref={foot} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="composer__box"
          rows={1}
          value={draft}
          placeholder={live ? 'Ask Claude something…' : 'This session has ended.'}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="composer__send"
          disabled={!draft.trim() || sending || !live}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </>
  );
}
