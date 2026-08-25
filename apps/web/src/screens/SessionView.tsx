import { type Session as SessionData, isLive } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Back, Check, Pill, Problem, Warn } from '../components/Bits.js';
import { Rail, Topbar } from '../components/Shell.js';
import { Terminal } from './Terminal.js';

type Tab = 'terminal' | 'waiting' | 'changes';

/**
 * One session, with the prototype's tabs.
 *
 * The terminal stays mounted while other tabs are shown — unmounting it would
 * detach and reattach, redrawing the screen every time you glanced at Changes.
 */
export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('terminal');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [projects, setProjects] = useState<
    { id: string; name: string; path: string; sessions: number }[]
  >([]);
  const [files, setFiles] = useState<{ path: string; edits: number; tool: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.sessions(), api.projects()]);
      setSessions(s.sessions);
      setProjects(p.projects);
    } catch {
      /* the banner already says when the server is unreachable */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (tab === 'changes') void api.changes(id).then((r) => setFiles(r.files));
  }, [tab, id]);

  const session = sessions.find((s) => s.id === id);
  const project = projects.find((p) => p.id === session?.projectId);

  /** Interrupts the run. Says so either way — silence reads as "broken". */
  async function stop() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.stopSession(id);
      setNote('Interrupted. The session is still open.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop that session.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(answer: 'approve' | 'deny') {
    setBusy(true);
    try {
      await api.decide(id, answer);
      await refresh();
      setTab('terminal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that answer.');
    } finally {
      setBusy(false);
    }
  }

  const ask = session?.ask ?? null;

  return (
    <div className="app">
      <Topbar alerts="off" onToggleAlerts={() => {}} onHome={onBack} />

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <Rail
          projects={projects}
          sessions={sessions}
          openId={id}
          expanded={expanded}
          onToggle={(pid) => setExpanded((e) => ({ ...e, [pid]: !e[pid] }))}
          onOpen={(sid) => {
            window.history.pushState({}, '', `/terminal/${sid}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          onAll={onBack}
        />

        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flexShrink: 0,
              padding: '10px 20px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <button type="button" className="icon-btn" onClick={onBack} aria-label="All projects">
              <Back />
            </button>
            <div className="col" style={{ gap: 3, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                <span style={{ color: 'var(--ink-3)' }}>{session?.projectName ?? '…'}</span>
                {project ? ` · ${project.path}` : ''}
                {session?.startedFrom ? ` · from ${session.startedFrom}` : ''}
              </span>
              <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {session?.title ?? id}
              </span>
            </div>
            <span className="spacer" />
            {session && <Pill status={session.status} />}
            {/* Offered only when there is something to interrupt. An ended
                session has nothing to stop, and a button that 500s is worse
                than no button. */}
            {session && isLive(session) && (
              <button
                type="button"
                className="btn btn--deny btn--sm"
                disabled={busy}
                onClick={() => void stop()}
                title="Interrupts what Claude is doing. The session stays open."
              >
                {busy ? 'Stopping…' : 'Stop'}
              </button>
            )}
          </div>

          {(error || note) && (
            <div style={{ padding: '10px 20px 0' }} aria-live="polite">
              {error && <Problem>{error}</Problem>}
              {note && !error && (
                <p className="note" style={{ color: 'var(--done)' }}>
                  {note}
                </p>
              )}
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Session views">
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === 'terminal'}
              onClick={() => setTab('terminal')}
            >
              Terminal
            </button>
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === 'waiting'}
              onClick={() => setTab('waiting')}
            >
              Waiting for you
              {ask && <span className="tab__badge tab__badge--need">1</span>}
            </button>
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === 'changes'}
              onClick={() => setTab('changes')}
            >
              Changes
              {files.length > 0 && <span className="tab__badge">{files.length}</span>}
            </button>
          </div>

          {/* Kept mounted, only hidden: unmounting would detach the terminal. */}
          <div
            style={{
              display: tab === 'terminal' ? 'flex' : 'none',
              flexDirection: 'column',
              flexGrow: 1,
              minHeight: 0,
            }}
          >
            <Terminal sessionId={id} />
          </div>

          {tab === 'waiting' && (
            <div className="pane" role="tabpanel" aria-label="Waiting for you">
              {!ask && (
                <div className="nothing">
                  <Check />
                  <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>
                    Nothing waiting on you here
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink-4)',
                      maxWidth: '44ch',
                      lineHeight: 1.5,
                    }}
                  >
                    If this session gets blocked, one request appears here, this tab turns amber,
                    and your phone buzzes. Only ever one at a time.
                  </span>
                </div>
              )}
              {ask && (
                <div className="col" style={{ gap: 14, maxWidth: 760 }}>
                  <div
                    className="row"
                    style={{
                      gap: 9,
                      padding: '10px 13px',
                      background: 'rgba(242,169,59,0.09)',
                      border: '1px solid rgba(242,169,59,0.3)',
                      borderRadius: 9,
                    }}
                  >
                    <Warn />
                    <span className="label" style={{ color: 'var(--need)' }}>
                      Waiting on you
                    </span>
                  </div>
                  <h2 style={{ fontSize: 24, margin: 0 }}>Run this?</h2>
                  {/* Shown in full: a command you cannot read is not one you can
                      honestly approve. */}
                  <code className="ask__what">{ask.detail}</code>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    via {ask.tool}
                  </span>
                  <div className="ask__row">
                    <button
                      type="button"
                      className="ask__yes"
                      disabled={busy}
                      onClick={() => void decide('approve')}
                    >
                      Approve once
                    </button>
                    <button
                      type="button"
                      className="ask__no"
                      disabled={busy}
                      onClick={() => void decide('deny')}
                    >
                      Deny
                    </button>
                  </div>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                    Denying is safe — Claude picks another route and keeps going.
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === 'changes' && (
            <div className="pane" role="tabpanel" aria-label="Changes">
              <div className="row" style={{ gap: 10 }}>
                <span className="label">Files this session touched</span>
                <span className="spacer" />
                <span className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                  {files.length} file{files.length === 1 ? '' : 's'}
                </span>
              </div>
              {files.length === 0 && (
                <div className="nothing">
                  <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Nothing changed yet</span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink-4)',
                      maxWidth: '48ch',
                      lineHeight: 1.5,
                    }}
                  >
                    Files written with Write or Edit appear here. Anything Claude changes through a
                    shell command will not — that comes from the transcript, later.
                  </span>
                </div>
              )}
              <div className="col" style={{ gap: 5, maxWidth: 720 }}>
                {files.map((f) => (
                  <div className="file-row" key={f.path}>
                    <span className="mono truncate" style={{ fontSize: 12, flexGrow: 1 }}>
                      {f.path}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {f.tool}
                    </span>
                    {f.edits > 1 && (
                      <span className="mono num" style={{ fontSize: 11, color: 'var(--work)' }}>
                        ×{f.edits}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
