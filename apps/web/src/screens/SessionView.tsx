import type { Agent, FileEdit } from '@claude-remote/shared';
import { type Session as SessionData, isLive, isStoppable } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Back, Check, Pill, Problem, Warn } from '../components/Bits.js';
import { Rail, Topbar } from '../components/Shell.js';
import { Chat } from './Chat.js';
import { Diff } from './Diff.js';
import { Files } from './Files.js';
import { Terminal } from './Terminal.js';

type Tab = 'chat' | 'terminal' | 'waiting' | 'agents' | 'changes' | 'files';

/**
 * One session, with the prototype's tabs.
 *
 * The terminal stays mounted while other tabs are shown — unmounting it would
 * detach and reattach, redrawing the screen every time you glanced at Changes.
 */
export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  // Chat is the default: it is the readable view, and the only one that can
  // show the whole conversation. The terminal is one tab over for when only a
  // real TUI will do.
  const [tab, setTab] = useState<Tab>('chat');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [projects, setProjects] = useState<
    { id: string; name: string; path: string; sessions: number }[]
  >([]);
  const [files, setFiles] = useState<{ path: string; edits: number; tool: string }[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [edits, setEdits] = useState<FileEdit[] | null>(null);
  const [editsError, setEditsError] = useState<string | null>(null);
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

  /* Agents move while you watch, so this one keeps polling — but only while
     the tab is open, because nobody needs a request every three seconds for a
     panel they are not looking at. */
  useEffect(() => {
    if (tab !== 'agents') return;
    const load = () =>
      void api
        .agents(id)
        .then((r) => setAgents(r.agents))
        .catch(() => {
          /* the topbar already says when the server is unreachable */
        });
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [tab, id]);

  const session = sessions.find((s) => s.id === id);
  const project = projects.find((p) => p.id === session?.projectId);

  /* Opening a file in Changes fetches what this session did to it — the edits,
     not the file. Closing drops them, so a stale diff can never be shown under
     a different file's name. */
  useEffect(() => {
    if (!openFile) return;
    let live = true;
    setEdits(null);
    setEditsError(null);
    api
      .edits(id, openFile)
      .then((r) => {
        if (live) setEdits(r.edits);
      })
      .catch((err: unknown) => {
        if (live) {
          setEditsError(err instanceof Error ? err.message : 'Could not read those changes.');
        }
      });
    return () => {
      live = false;
    };
  }, [openFile, id]);

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
      setTab('chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that answer.');
    } finally {
      setBusy(false);
    }
  }

  const ask = session?.ask ?? null;
  /* Subagents only: the main agent is always "working" while the session is,
     and counting it would make the badge say 1 for every idle session. */
  const working = agents.filter((a) => a.sub && a.status === 'working').length;

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
            {/* Offered only when there is something to interrupt. A session
                idling at its prompt is still alive, but stopping it would do
                nothing except clear whatever is typed into Claude's input. */}
            {session && isStoppable(session) && (
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
              aria-selected={tab === 'chat'}
              onClick={() => setTab('chat')}
            >
              Chat
            </button>
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
              {/* Two labels, one shown at a time by CSS. Five tabs at 414px do
                  not fit "Waiting for you", and the prototype has always
                  shortened it on a phone. */}
              <span className="tab__long">Waiting for you</span>
              <span className="tab__short">Waiting</span>
              {ask && <span className="tab__badge tab__badge--need">1</span>}
            </button>
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === 'agents'}
              onClick={() => setTab('agents')}
            >
              Agents
              {working > 0 && <span className="tab__badge tab__badge--work">{working}</span>}
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
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={tab === 'files'}
              onClick={() => setTab('files')}
            >
              Preview
            </button>
          </div>

          {tab === 'chat' && (
            <div className="pane pane--chat" role="tabpanel" aria-label="Chat">
              <Chat sessionId={id} live={Boolean(session && isLive(session))} />
            </div>
          )}

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

          {tab === 'agents' && (
            <div className="pane" role="tabpanel" aria-label="Agents">
              <div className="row" style={{ gap: 10 }}>
                <span className="label">Who is working on this</span>
                <span className="spacer" />
                <span className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                  {working === 0 ? 'no subagents running' : `${working} running`}
                </span>
              </div>
              <div className="col" style={{ gap: 5, maxWidth: 720 }}>
                {agents.map((a, i) => (
                  <div
                    className={`agent${a.sub ? ' agent--sub' : ''}`}
                    key={`${a.name}-${a.startedAt}-${i}`}
                  >
                    <span
                      className={`dot${a.status === 'working' ? ' dot--pulse' : ''}`}
                      style={{
                        background: a.status === 'working' ? 'var(--work)' : 'var(--done)',
                      }}
                    />
                    <span className="agent__name">{a.name}</span>
                    <span className="agent__doing truncate">{a.doing ?? '—'}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                      {a.status === 'working' ? 'working' : 'done'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Said plainly rather than left to be inferred from an empty
                  list: subagents are only visible because Claude Code reports
                  Task through a hook, and a run with none is the normal case. */}
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--ink-4)',
                  maxWidth: '52ch',
                  lineHeight: 1.5,
                }}
              >
                Subagents appear when Claude delegates with the Task tool, and are paired from its
                own hooks — never read off the terminal. A session that does its own work shows only
                main.
              </span>
            </div>
          )}

          {tab === 'files' && session?.projectId && <Files projectId={session.projectId} />}

          {tab === 'changes' && (
            <div className="pane" role="tabpanel" aria-label="Changes">
              <div className="row" style={{ gap: 10 }}>
                <span className="label">Files this session touched</span>
                <span className="spacer" />
                <span className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                  {files.length} file{files.length === 1 ? '' : 's'} · tap to see the edits
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
              <div className="col" style={{ gap: 5, maxWidth: 760 }}>
                {files.map((f) => {
                  const open = openFile === f.path;
                  return (
                    <div className="file" key={f.path}>
                      <button
                        type="button"
                        className="file__head"
                        aria-expanded={open}
                        onClick={() => setOpenFile(open ? null : f.path)}
                      >
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
                      </button>
                      {open && (
                        <>
                          <div className="pv__bar">
                            <span className="pv__note">
                              {edits
                                ? `${edits.length} edit${edits.length === 1 ? '' : 's'} in this session`
                                : editsError
                                  ? 'could not be shown'
                                  : 'reading…'}
                            </span>
                            <span className="spacer" />
                            <button
                              type="button"
                              className="btn btn--line btn--sm"
                              onClick={() => setOpenFile(null)}
                            >
                              Collapse
                            </button>
                          </div>
                          {editsError && (
                            <div style={{ padding: '12px 14px' }}>
                              <Problem>{editsError}</Problem>
                            </div>
                          )}
                          {edits && <Diff edits={edits} />}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
