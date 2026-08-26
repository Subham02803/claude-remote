import type { Workspace } from '@claude-remote/shared';
import { useEffect, useRef, useState } from 'react';
import { Check, Chev, Plus } from './Bits.js';

/**
 * The workspace switcher, top left.
 *
 * A workspace is a named set of projects, and which one you are in changes what
 * every other surface shows — the rail, the overview, the project a new session
 * can start in. That makes it furniture rather than a setting, so it sits in the
 * topbar next to the brand where it is always visible and never hunted for.
 */
export function WorkspaceMenu({
  workspaces,
  currentId,
  onSelect,
  onCreate,
}: {
  workspaces: Workspace[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // Click-away and Escape, because a dropdown that only closes by re-clicking
  // its own button is a dropdown people leave open by accident.
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName('');
      setAdding(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that workspace.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wsmenu" ref={box}>
      <button
        type="button"
        className="wsmenu__button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="wsmenu__name">{current?.name ?? 'no workspace'}</span>
        <Chev down />
      </button>

      {open && (
        <div className="wsmenu__panel" role="menu">
          <span className="label" style={{ padding: '2px 10px 6px' }}>
            Workspaces
          </span>

          {workspaces.map((w) => (
            <button
              type="button"
              className="wsmenu__item"
              role="menuitem"
              key={w.id}
              aria-current={w.id === current?.id}
              onClick={() => {
                onSelect(w.id);
                setOpen(false);
              }}
            >
              <span className="wsmenu__tick">{w.id === current?.id ? <Check /> : null}</span>
              <span className="truncate">{w.name}</span>
              <span className="spacer" />
              <span className="wsmenu__count">
                {w.projects.length || '—'}
                {w.projects.length ? ' proj' : ''}
              </span>
            </button>
          ))}

          {workspaces.length === 0 && (
            <span className="wsmenu__note">None yet. Make the first one below.</span>
          )}

          <span className="hr" />

          {adding ? (
            <div className="wsmenu__new">
              <input
                ref={field}
                className="wsmenu__field"
                value={name}
                placeholder="workspace name"
                maxLength={60}
                onChange={(ev) => setName(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') void create();
                  if (ev.key === 'Escape') setAdding(false);
                }}
              />
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy || !name.trim()}
                onClick={() => void create()}
              >
                create
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="wsmenu__item wsmenu__item--action"
              role="menuitem"
              onClick={() => setAdding(true)}
            >
              <span className="wsmenu__tick">
                <Plus />
              </span>
              New workspace
            </button>
          )}

          {error && <span className="wsmenu__note wsmenu__note--bad">{error}</span>}
        </div>
      )}
    </div>
  );
}
