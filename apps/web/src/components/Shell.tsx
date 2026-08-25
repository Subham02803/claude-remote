import type { Project, Session } from '@claude-remote/shared';
import { Brand, Check, Chev, Warn, railColour } from './Bits.js';

/**
 * The furniture every screen shares: topbar, the one-line answer to "does
 * anything need me?", and the project rail.
 *
 * Lifted from design/prototype.html. The rail is hidden below 720px, where the
 * prototype's phone layout drops it too — scope P5 says the small screen is the
 * primary target, and a sidebar is the first thing that has to go.
 */

export function Topbar({
  alerts,
  onToggleAlerts,
  onHome,
}: {
  alerts: 'on' | 'off';
  onToggleAlerts: () => void;
  onHome: () => void;
}) {
  return (
    <div className="topbar">
      <button
        type="button"
        onClick={onHome}
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}
        aria-label="All projects"
      >
        <Brand />
      </button>
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
      <span className="host">
        <span className="dot" style={{ background: 'var(--done)' }} />
        home-mac
      </span>
      <span className="spacer" />
      <button
        type="button"
        className="alerts"
        data-on={alerts === 'on'}
        onClick={onToggleAlerts}
        title="Only two things ever notify you: a run that is blocked, and one that failed."
      >
        {alerts === 'on' ? 'alerts on' : 'alerts off'}
      </button>
    </div>
  );
}

/** Scope P3: the single most important line on the screen. */
export function Banner({
  sessions,
  onJump,
}: {
  sessions: Session[];
  onJump: (id: string) => void;
}) {
  const waiting = sessions.filter((s) => s.status === 'waiting');
  const working = sessions.filter((s) => s.status === 'working').length;

  if (waiting.length) {
    const first = waiting[0];
    if (!first) return null;
    return (
      <div className="banner banner--need" aria-live="polite">
        <Warn />
        <span className="col" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--need-ink)' }}>
            Claude is waiting on your answer
            {waiting.length > 1 && (
              <span style={{ color: 'var(--need-dim)' }}> +{waiting.length - 1} more</span>
            )}
          </span>
          <span className="where">
            <b>{first.projectName}</b> / <b>{first.title}</b>
          </span>
        </span>
        <span className="spacer" />
        <button type="button" className="link-btn" onClick={() => onJump(first.id)}>
          Go there →
        </button>
      </div>
    );
  }

  return (
    <div className="banner banner--calm" aria-live="polite">
      <Check />
      <span style={{ fontSize: 13.5, fontWeight: 500, color: '#8FD9B4' }}>
        Nothing is waiting on you
      </span>
      <span className="mono num" style={{ fontSize: 11.5, color: '#6E9C82' }}>
        {working} session{working === 1 ? '' : 's'} running
      </span>
    </div>
  );
}

export function Rail({
  projects,
  sessions,
  openId,
  expanded,
  onToggle,
  onOpen,
  onAll,
}: {
  projects: Project[];
  sessions: Session[];
  openId: string | null;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <div className="rail">
      <span className="label" style={{ padding: '0 9px 6px' }}>
        Projects
      </span>

      <button type="button" className="proj" aria-pressed={!openId} onClick={onAll}>
        <span className="caretx" />
        <span className="proj__name">all projects</span>
        <span className="proj__count">{sessions.length}</span>
      </button>

      {projects.map((p) => {
        const mine = sessions.filter((s) => s.projectId === p.id);
        const open = !!expanded[p.id];
        const waiting = mine.some((s) => s.status === 'waiting');
        const busy = mine.some((s) => s.status === 'working');
        const dot = waiting
          ? 'var(--need)'
          : busy
            ? 'var(--work)'
            : mine.length
              ? 'var(--line-strong)'
              : 'var(--line)';
        return (
          <div key={p.id}>
            <button
              type="button"
              className="proj"
              aria-expanded={open}
              onClick={() => onToggle(p.id)}
            >
              <span className="caretx">{mine.length ? <Chev down={open} /> : null}</span>
              <span className="dot" style={{ width: 7, height: 7, background: dot }} />
              <span className="proj__name">{p.name}</span>
              <span className="proj__count">{mine.length || ''}</span>
            </button>

            {open &&
              mine.map((s) => (
                <button
                  type="button"
                  className="sess-link"
                  key={s.id}
                  aria-current={openId === s.id}
                  onClick={() => onOpen(s.id)}
                >
                  <span
                    className={`dot${s.status === 'working' || s.status === 'waiting' ? ' dot--pulse' : ''}`}
                    style={{ width: 5, height: 5, background: railColour(s.status) }}
                  />
                  <span className="sess-link__name">{s.title}</span>
                </button>
              ))}

            {open && mine.length === 0 && (
              <span className="sess-link" style={{ cursor: 'default', fontSize: 11.5 }}>
                no sessions yet
              </span>
            )}
          </div>
        );
      })}

      <span className="spacer" />
      <span
        className="mono"
        style={{ padding: '10px 9px', fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.5 }}
      >
        on your tailnet · no sign-in
      </span>
    </div>
  );
}
