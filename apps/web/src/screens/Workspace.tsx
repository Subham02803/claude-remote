import { type Project, type Session, isLive } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Pill, Plus, Problem, railColour } from '../components/Bits.js';
import { Banner, Rail, Topbar } from '../components/Shell.js';
import { type PushState, disablePush, enablePush, pushState, sendTestAlert } from '../push.js';

/**
 * Everything running, across every project — the prototype's overview screen.
 *
 * A card shows what its session is actually doing, and a session that needs an
 * answer is unmistakable: amber rail, amber border, and the banner above
 * pointing at it.
 */
/** How long ago, in the prototype's terse style. */
function since(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ${mins % 60}m` : `${Math.floor(hrs / 24)}d ago`;
}

export function Workspace({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedOnce, setExpandedOnce] = useState(false);
  const [alerts, setAlerts] = useState<PushState>('off');
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.projects(), api.sessions()]);
      setProjects(p.projects);
      setSessions(s.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach the server.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void pushState().then(setAlerts);
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // Open the projects that actually have something in them, once. Doing it on
  // every poll would fight anyone who collapsed one on purpose.
  useEffect(() => {
    if (expandedOnce || sessions.length === 0) return;
    const withWork: Record<string, boolean> = {};
    for (const s of sessions) withWork[s.projectId] = true;
    setExpanded(withWork);
    setExpandedOnce(true);
  }, [sessions, expandedOnce]);

  async function toggleAlerts() {
    setNote(null);
    const next = alerts === 'on' ? await disablePush() : await enablePush();
    setAlerts(next);
    if (next === 'insecure') {
      setNote('Alerts need https. Run `tailscale serve --bg 4180` and open the ts.net address.');
    } else if (next === 'denied') {
      setNote('This browser has blocked notifications. Allow them in site settings.');
    } else if (next === 'on') {
      const sent = await sendTestAlert();
      setNote(sent > 0 ? 'Alerts on — a test notification is on its way.' : 'Alerts on.');
    }
  }

  async function start(projectId: string) {
    setBusy(true);
    try {
      const { session } = await api.startSession(projectId);
      onOpen(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a session.');
    } finally {
      setBusy(false);
    }
  }

  const live = sessions.filter(isLive);
  const withSessions = projects.filter((p) => sessions.some((s) => s.projectId === p.id));

  return (
    <div className="app">
      <Topbar
        alerts={alerts === 'on' ? 'on' : 'off'}
        onToggleAlerts={() => void toggleAlerts()}
        onHome={() => {}}
      />
      <Banner sessions={sessions} onJump={onOpen} />

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <Rail
          projects={projects}
          sessions={sessions}
          openId={null}
          expanded={expanded}
          onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
          onOpen={onOpen}
          onAll={() => {}}
        />

        <div className="main">
          <div className="main__head">
            <div className="col" style={{ gap: 3 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>Everything running</h1>
              <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                {live.length} session{live.length === 1 ? '' : 's'} across {withSessions.length}{' '}
                project{withSessions.length === 1 ? '' : 's'}
              </span>
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--md"
              disabled={busy || projects.length === 0}
              onClick={() => void start(projects[0]?.id ?? '')}
            >
              <Plus /> New session
            </button>
          </div>

          {error && <Problem>{error}</Problem>}
          {note && (
            <p className="note" style={{ color: 'var(--need-ink)' }}>
              {note}
            </p>
          )}

          <div className="groups">
            {projects.map((p) => {
              const mine = sessions.filter((s) => s.projectId === p.id);
              return (
                <div className="col" style={{ gap: 9 }} key={p.id}>
                  <div className="group__head">
                    <span
                      className="dot"
                      style={{
                        width: 7,
                        height: 7,
                        background: mine.some((s) => s.status === 'waiting')
                          ? 'var(--need)'
                          : 'var(--line-strong)',
                      }}
                    />
                    <span className="group__name">{p.name}</span>
                    <span className="group__path">{p.path}</span>
                    <span className="spacer" />
                    <span className="mono num" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {mine.length} session{mine.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      className="link-btn link-btn--quiet"
                      disabled={busy}
                      onClick={() => void start(p.id)}
                    >
                      <Plus /> new session
                    </button>
                  </div>

                  <div className="col" style={{ gap: 8 }}>
                    {mine.length === 0 && (
                      <div className="nothing" style={{ padding: 22 }}>
                        <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                          No sessions in this project yet
                        </span>
                      </div>
                    )}

                    {mine.map((s) => (
                      <button
                        type="button"
                        className={`card${s.status === 'waiting' ? ' card--need' : ''}`}
                        key={s.id}
                        onClick={() => onOpen(s.id)}
                        style={{ opacity: isLive(s) ? 1 : 0.55 }}
                      >
                        <div className="card__rail" style={{ background: railColour(s.status) }} />
                        <div className="card__body">
                          <div className="card__head">
                            <span
                              className="card__title"
                              style={{ color: isLive(s) ? undefined : 'var(--ink-3)' }}
                            >
                              {s.title}
                            </span>
                            <span className="spacer" />
                            {s.attached && (
                              <span
                                className="mono"
                                style={{ fontSize: 11, color: 'var(--ink-4)' }}
                              >
                                attached
                              </span>
                            )}
                            <Pill status={s.status} />
                            <span className="card__meta">{since(s.statusAt ?? s.createdAt)}</span>
                          </div>
                          <div className="card__line">
                            <span className="truncate">
                              {s.ask ? (
                                <span style={{ color: 'var(--need)' }}>{s.ask.detail}</span>
                              ) : (
                                (s.doing ?? 'no word yet')
                              )}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="note">
            Closing a terminal only detaches. Ending a session is the one thing that stops the work.
          </p>
        </div>
      </div>
    </div>
  );
}
