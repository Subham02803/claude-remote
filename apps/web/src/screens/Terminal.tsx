import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Composer } from '../components/Composer.js';

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

  useEffect(() => {
    if (!host.current) return;

    const term = new Xterm({
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      // xterm cannot read the stylesheet, so the palette is spelled out
      // again here. These four are --term, --ink-2 and --accent; if those
      // move, these move with them.
      theme: {
        background: '#070C14',
        foreground: '#C3D0DE',
        cursor: '#38BDF8',
        selectionBackground: 'rgba(56,189,248,0.25)',
      },
      // Zero on purpose. tmux owns scrolling (mouse is enabled on attach), and
      // a local buffer here is not a smaller copy of that history — it is the
      // torn remains of full-screen repaints, which is what made scrolling up
      // show pieces of older frames. None is better than wrong.
      scrollback: 0,
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
      {/*
        A real box instead of the on-screen keyboard inside an xterm — scope
        §5.1, and the only place an image can be attached from a phone.
      */}
      <Composer
        sessionId={sessionId}
        live={link === 'live'}
        placeholder="Type a prompt here instead of in the terminal…"
        offlinePlaceholder="Reconnecting…"
      />
    </>
  );
}
