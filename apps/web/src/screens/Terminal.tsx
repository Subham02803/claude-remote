import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

type Link = 'connecting' | 'live' | 'closed';

/**
 * The terminal pane, attached to a tmux session on the machine.
 *
 * Nothing here owns anything: leaving detaches, and whatever is running keeps
 * running. That is why there is no "are you sure" and no attempt to save
 * scrollback — tmux already has both covered.
 */
export function Terminal({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  /**
   * Sending a prompt without the on-screen keyboard fighting the terminal.
   * Scope §5.1 — long prompts on a phone inside an xterm are miserable.
   */
  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.sendPrompt(sessionId, text);
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!host.current) return;

    const term = new Xterm({
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0A0B0E',
        foreground: '#C9D0DA',
        cursor: '#F2A93B',
        selectionBackground: 'rgba(242,169,59,0.25)',
      },
      // tmux keeps the real scrollback; this is only what the browser holds.
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/terminal/${encodeURIComponent(sessionId)}?cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setLink('live');
      term.focus();
    };
    ws.onmessage = (ev) => term.write(String(ev.data));
    ws.onclose = (ev) => {
      setLink('closed');
      // 1008 is our "no such session" — say so, rather than implying it is
      // still there and merely disconnected.
      const why = ev.code === 1008 ? ev.reason || 'session is gone' : 'detached';
      term.write(`\r\n\x1b[38;5;208m— ${why} —\x1b[0m\r\n`);
    };

    const post = (msg: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const typed = term.onData((d) => post({ t: 'i', d }));

    // Resize is the usual source of a mangled TUI, so it is wired from the
    // start rather than added once the layout settles.
    const pushSize = () => {
      fit.fit();
      post({ t: 'r', cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(pushSize);
    ro.observe(host.current);
    window.addEventListener('resize', pushSize);

    return () => {
      typed.dispose();
      ro.disconnect();
      window.removeEventListener('resize', pushSize);
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <>
      <div className="term-host" ref={host} />
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
          placeholder={
            link === 'live' ? 'Type a prompt here instead of in the terminal…' : 'Reconnecting…'
          }
          disabled={link !== 'live'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift-Enter is a newline — the same as every chat box
            // anyone has used, which is the point.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="composer__send"
          disabled={!draft.trim() || sending || link !== 'live'}
        >
          Send
        </button>
      </form>
    </>
  );
}
