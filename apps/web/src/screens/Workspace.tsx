import { type Project, type Session, isLive } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Pill, Plus, Problem, Trash, railColour } from '../components/Bits.js';
import { FolderPicker } from '../components/FolderPicker.js';
import { Banner, Rail, Topbar } from '../components/Shell.js';
import { type PushState, disablePush, enablePush, pushState, sendTestAlert } from '../push.js';
import type { Workspaces } from '../workspaces.js';

/**
 * Everything running in the workspace you are in — the prototype's overview.
 *
 * A card shows what its session is actually doing, and a session that needs an
 * answer is unmistakable: amber rail, amber border, and the banner above
 * pointing at it. The banner is deliberately *not* scoped to the workspace:
 * "does anything need me" is a question about the machine, and hiding a blocked
 * session because it lives in another workspace would be the one lie this
 * screen must not tell.
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

export function Workspace({ onOpen, ws }: { onOpen: (id: string) => void; ws: Workspaces }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedOnce, setExpandedOnce] = useState(false);
  const [alerts, setAlerts] = useState<PushState>('off');
  /**
   * The last thing that happened, and the workspace it happened in.
   *
   * Kept together so switching workspace retires the message on its own:
   * "Removed SchoolConnect" describes a screen you are no longer looking at.
   */
  const [said, setSaid] = useState<{ workspace: string | null; note: string } | null>(null);
  const [picking, setPicking] = useState(false);
  /** The project whose removal is awaiting a second click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The ended session whose deletion is awaiting a second click. */
  const [dropping, setDropping] = useState<string | null>(null);

  const projects: Project[] = ws.current?.projects ?? [];

  const refresh = useCallback(async () => {
    try {
      const s = await api.sessions();
      setSessions(s.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach the server.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void pushState().then(setAlerts);
    const t = setInterval(() => {
      void refresh();
      // Session counts live on the projects, so the workspace list has to keep
      // up with them.
      void ws.reload();
    }, 3000);
    return () => clearInterval(t);
  }, [refresh, ws.reload]);

  const currentId = ws.current?.id ?? null;
  const note = said && said.workspace === currentId ? said.note : null;

  /** Says something about the workspace it is being said in. */
  function say(text: string | null) {
    setSaid(text === null ? null : { workspace: currentId, note: text });
  }

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
    say(null);
    const next = alerts === 'on' ? await disablePush() : await enablePush();
    setAlerts(next);
    if (next === 'insecure') {
      say('Alerts need https. Run `tailscale serve --bg 4180` and open the ts.net address.');
    } else if (next === 'denied') {
      say('This browser has blocked notifications. Allow them in site settings.');
    } else if (next === 'on') {
      const sent = await sendTestAlert();
      say(sent > 0 ? 'Alerts on — a test notification is on its way.' : 'Alerts on.');
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

  async function addProject(path: string, name: string) {
    if (!ws.current) return;
    await api.addProject(ws.current.id, path, name);
    await ws.reload();
    setPicking(false);
    say(`Added ${name}.`);
  }

  async function removeProject(id: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      await api.removeProject(id);
      await ws.reload();
      say(`Removed ${name}. Anything it already ran is still in the history.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that project.');
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  }

  /**
   * Forgetting an ended session.
   *
   * Only our record goes. The work stopped when the session ended, and Claude
   * Code's own transcript under ~/.claude is its file, not ours to delete.
   */
  async function dropSession(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteSession(sessionId);
      say('Session deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that session.');
    } finally {
      setDropping(null);
      setBusy(false);
    }
  }

  /** Only this workspace's work belongs in the lists below. */
  const mineIds = new Set(projects.map((p) => p.id));
  const inWorkspace = sessions.filter((s) => mineIds.has(s.projectId));
  const live = inWorkspace.filter(isLive);
  const withSessions = projects.filter((p) => inWorkspace.some((s) => s.projectId === p.id));

  return (
    <div className="app">
      <Topbar
        alerts={alerts === 'on' ? 'on' : 'off'}
        onToggleAlerts={() => void toggleAlerts()}
        onHome={() => {}}
        workspaces={ws.workspaces}
        workspaceId={ws.current?.id ?? null}
        onSelectWorkspace={ws.select}
        onCreateWorkspace={ws.create}
      />
      <Banner sessions={sessions} onJump={onOpen} />

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <Rail
          projects={projects}
          sessions={inWorkspace}
          openId={null}
          expanded={expanded}
          onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
          onOpen={onOpen}
          onAll={() => {}}
        />

        <div className="main">
          <div className="main__head">
            <div className="col" style={{ gap: 3 }}>
              <h1 style={{ fontSize: 26, margin: 0 }}>{ws.current?.name ?? 'No workspace'}</h1>
              <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                {live.length} session{live.length === 1 ? '' : 's'} across {withSessions.length}{' '}
                project{withSessions.length === 1 ? '' : 's'}
              </span>
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--md btn--line"
              disabled={!ws.current}
              onClick={() => setPicking(true)}
            >
              <Plus /> Add project
            </button>
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

          {!ws.loading && ws.workspaces.length === 0 && (
            <div className="nothing" style={{ padding: 30 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                No workspaces yet. Make one from the menu at the top left, then add the folders you
                work in.
              </span>
            </div>
          )}

          {ws.current && projects.length === 0 && (
            <div className="nothing" style={{ padding: 30, gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                Nothing in <b>{ws.current.name}</b> yet. A project is a folder Claude may be started
                in.
              </span>
              <button type="button" className="btn btn--md" onClick={() => setPicking(true)}>
                <Plus /> Add the first project
              </button>
            </div>
          )}

          <div className="groups">
            {projects.map((p) => {
              const mine = inWorkspace.filter((s) => s.projectId === p.id);
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

                    {confirming === p.id ? (
                      <>
                        <span style={{ fontSize: 11.5, color: 'var(--need-ink)' }}>
                          remove from this workspace?
                        </span>
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() => void removeProject(p.id, p.name)}
                        >
                          remove
                        </button>
                        <button
                          type="button"
                          className="link-btn link-btn--quiet"
                          onClick={() => setConfirming(null)}
                        >
                          keep
                        </button>
                      </>
                    ) : (
                      <>
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
                        <button
                          type="button"
                          className="icon-btn icon-btn--plain"
                          title={`Remove ${p.name} from this workspace`}
                          aria-label={`Remove ${p.name} from this workspace`}
                          onClick={() => setConfirming(p.id)}
                        >
                          <Trash />
                        </button>
                      </>
                    )}
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
                      <div
                        className={`card${s.status === 'waiting' ? ' card--need' : ''}`}
                        key={s.id}
                        style={{ opacity: isLive(s) ? 1 : 0.55 }}
                      >
                        <div className="card__rail" style={{ background: railColour(s.status) }} />
                        <button type="button" className="card__open" onClick={() => onOpen(s.id)}>
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
                        </button>

                        {/* Only once it has ended. A running session is stopped
                            from inside it, and offering to delete the record of
                            work that is still happening would be a trap. */}
                        {!isLive(s) && (
                          <span className="card__side">
                            {dropping === s.id ? (
                              <>
                                <button
                                  type="button"
                                  className="link-btn"
                                  disabled={busy}
                                  onClick={() => void dropSession(s.id)}
                                >
                                  delete
                                </button>
                                <button
                                  type="button"
                                  className="link-btn link-btn--quiet"
                                  onClick={() => setDropping(null)}
                                >
                                  keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="icon-btn icon-btn--plain"
                                title={`Delete "${s.title}" from the list`}
                                aria-label={`Delete "${s.title}" from the list`}
                                onClick={() => setDropping(s.id)}
                              >
                                <Trash />
                              </button>
                            )}
                          </span>
                        )}
                      </div>
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

      {picking && ws.current && (
        <FolderPicker
          workspaceName={ws.current.name}
          onPick={addProject}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
