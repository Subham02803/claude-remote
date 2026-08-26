import type { FolderListing } from '@claude-remote/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Folder, Git, Plus } from './Bits.js';

/**
 * Picking a folder to turn into a project.
 *
 * Home is the whole world here, and that is the server's rule rather than this
 * component's: `/api/folders` refuses anything that resolves outside it. What
 * this side never does is build an absolute path — every request is a path
 * *relative to home*, so the same code drives `/Users/you` on a Mac and
 * `C:\Users\you` on Windows without knowing which it is talking to. The listing
 * carries `home` and `sep` purely so the crumbs can be spelled the way the
 * machine would spell them.
 */
export function FolderPicker({
  workspaceName,
  onPick,
  onClose,
}: {
  workspaceName: string;
  /** Called with a home-relative path and the name to file it under. */
  onPick: (path: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [at, setAt] = useState('');
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const next = await api.folders(path);
      setListing(next);
      setAt(next.path);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  // The name follows the folder until it is typed into, at which point it is
  // the person's answer and moving it under them would be rude.
  const [nameTouched, setNameTouched] = useState(false);
  useEffect(() => {
    if (nameTouched) return;
    setName(at === '' ? '' : (at.split('/').pop() ?? ''));
  }, [at, nameTouched]);

  async function add() {
    if (!at) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(at, name.trim() || (at.split('/').pop() ?? at));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that folder.');
    } finally {
      setBusy(false);
    }
  }

  /** Home, then each segment: clicking one jumps back up to it. */
  const crumbs = at === '' ? [] : at.split('/');
  const visible = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const hiddenCount = (listing?.entries ?? []).length - visible.length;

  return (
    <dialog className="picker" ref={dialog} onClose={onClose} aria-label="Choose a folder">
      <div className="picker__bar">
        <span className="col" style={{ gap: 2, minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>Add a project</b>
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>to {workspaceName}</span>
        </span>
        <span className="spacer" />
        <button type="button" className="link-btn link-btn--quiet" onClick={onClose}>
          close
        </button>
      </div>

      <div className="picker__crumbs">
        <button type="button" className="crumb" onClick={() => void load('')}>
          {listing?.home ?? '~'}
        </button>
        {crumbs.map((part, i) => {
          const to = crumbs.slice(0, i + 1).join('/');
          return (
            <span key={to} className="row" style={{ gap: 0, alignItems: 'center' }}>
              <span className="picker__sep">{listing?.sep ?? '/'}</span>
              <button type="button" className="crumb" onClick={() => void load(to)}>
                {part}
              </button>
            </span>
          );
        })}
      </div>

      <div className="picker__list">
        {listing?.parent !== null && listing && (
          <button type="button" className="entry" onClick={() => void load(listing.parent ?? '')}>
            <span className="entry__icon">
              <Folder />
            </span>
            <span className="truncate">..</span>
          </button>
        )}

        {loading && <span className="picker__note">reading…</span>}

        {!loading &&
          visible.map((e) => (
            <button
              type="button"
              className="entry"
              key={e.path}
              onClick={() => void load(e.path)}
              style={{ opacity: e.hidden ? 0.6 : 1 }}
            >
              <span className="entry__icon">
                <Folder />
              </span>
              <span className="truncate">{e.name}</span>
              <span className="spacer" />
              {e.repo && (
                <span className="picker__tag" title="has a .git">
                  <Git /> repo
                </span>
              )}
              {e.added && <span className="picker__tag picker__tag--on">added</span>}
            </button>
          ))}

        {!loading && visible.length === 0 && (
          <span className="picker__note">
            {hiddenCount > 0 ? 'Only hidden folders in here.' : 'No folders in here.'}
          </span>
        )}

        {listing?.truncated && (
          <span className="picker__note">Only the first 500 folders are shown.</span>
        )}
      </div>

      <div className="picker__foot">
        <label className="picker__hidden">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(ev) => setShowHidden(ev.target.checked)}
          />
          show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
        </label>
        <span className="spacer" />
      </div>

      {error && <p className="picker__error">{error}</p>}

      <div className="picker__pick">
        <span className="col" style={{ gap: 3, minWidth: 0, flexGrow: 1 }}>
          <span className="label">this folder</span>
          <span className="mono truncate" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            {at === ''
              ? (listing?.home ?? '~')
              : `${listing?.home ?? '~'}${listing?.sep ?? '/'}${at.split('/').join(listing?.sep ?? '/')}`}
          </span>
        </span>
        <input
          className="picker__name"
          value={name}
          placeholder="name"
          onChange={(ev) => {
            setNameTouched(true);
            setName(ev.target.value);
          }}
          aria-label="Project name"
        />
        <button
          type="button"
          className="btn btn--md"
          disabled={busy || at === '' || loading}
          onClick={() => void add()}
          title={at === '' ? 'Go into a folder first — home itself is not a project.' : undefined}
        >
          <Plus /> Add project
        </button>
      </div>
    </dialog>
  );
}
