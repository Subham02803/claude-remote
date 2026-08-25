import type { DirEntry, DirListing, FilePreview } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Problem } from '../components/Bits.js';
import { Preview, PreviewFull, previewNote } from './Preview.js';

/** `docs/design/x.md` → the crumbs you can click back to. */
function crumbs(path: string): { name: string; path: string }[] {
  if (!path) return [];
  const parts = path.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

function size(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Browsing the project, and reading what is in it.
 *
 * Separate from Changes on purpose. Changes answers "what did this session
 * do"; this answers "what is in the project" — including files no session ever
 * touched. Same containment rules on the server; the root is where it starts.
 *
 * Deliberately read-only. Scope §5.4 rules out a browser IDE, and a file tree
 * that can only be read is a long way from one that can edit, rename or delete.
 */
export function Files({ projectId }: { projectId: string }) {
  const [dir, setDir] = useState('');
  const [listing, setListing] = useState<DirListing | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [file, setFile] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const load = useCallback(
    async (at: string) => {
      setError(null);
      try {
        setListing(await api.tree(projectId, at));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that folder.');
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load(dir);
  }, [load, dir]);

  useEffect(() => {
    if (!open) {
      setFile(null);
      return;
    }
    let live = true;
    setFile(null);
    setError(null);
    api
      .file(projectId, open)
      .then((f) => {
        if (live) setFile(f);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not read that file.');
      });
    return () => {
      live = false;
    };
  }, [open, projectId]);

  function enter(entry: DirEntry) {
    if (entry.dir) {
      setOpen(null);
      setFull(false);
      setDir(entry.path);
    } else {
      setOpen(open === entry.path ? null : entry.path);
      setFull(false);
    }
  }

  const trail = crumbs(listing?.path ?? dir);

  return (
    <div className="pane" role="tabpanel" aria-label="Preview">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="crumb"
          onClick={() => {
            setDir('');
            setOpen(null);
          }}
        >
          project
        </button>
        {trail.map((c) => (
          <span className="row" style={{ gap: 8 }} key={c.path}>
            <span style={{ color: 'var(--ink-4)' }}>/</span>
            <button
              type="button"
              className="crumb"
              onClick={() => {
                setDir(c.path);
                setOpen(null);
              }}
            >
              {c.name}
            </button>
          </span>
        ))}
        <span className="spacer" />
        {listing && (
          <span className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
            {listing.entries.length} item{listing.entries.length === 1 ? '' : 's'}
            {listing.truncated ? ' · cut at 800' : ''}
          </span>
        )}
      </div>

      {error && <Problem>{error}</Problem>}

      <div className="col" style={{ gap: 4, maxWidth: 760 }}>
        {dir !== '' && (
          <button
            type="button"
            className="entry"
            onClick={() => {
              const up = dir.split('/').slice(0, -1).join('/');
              setDir(up);
              setOpen(null);
            }}
          >
            <span className="entry__icon">↑</span>
            <span className="mono" style={{ fontSize: 12.5, flexGrow: 1 }}>
              ..
            </span>
          </button>
        )}

        {listing?.entries.map((e) => {
          const isOpen = open === e.path;
          return (
            <div key={e.path}>
              <button
                type="button"
                className={`entry${isOpen ? ' entry--open' : ''}`}
                onClick={() => enter(e)}
                aria-expanded={e.dir ? undefined : isOpen}
              >
                <span className="entry__icon">{e.dir ? '▸' : '·'}</span>
                <span
                  className="mono truncate"
                  style={{ fontSize: 12.5, flexGrow: 1, color: e.dir ? 'var(--ink-2)' : undefined }}
                >
                  {e.name}
                </span>
                {e.kind && e.kind !== 'text' && <span className="kind">{e.kind}</span>}
                <span className="mono num" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {size(e.bytes)}
                </span>
              </button>

              {isOpen && (
                <div className="file" style={{ marginTop: 4 }}>
                  <div className="pv__bar">
                    {file && <span className="kind">{file.kind}</span>}
                    <span className="pv__note">
                      {file ? previewNote(file.kind) : error ? 'could not be shown' : 'reading…'}
                    </span>
                    <span className="spacer" />
                    {file && (
                      <button
                        type="button"
                        className="btn btn--line btn--sm"
                        onClick={() => setFull(true)}
                      >
                        Full screen
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--line btn--sm"
                      onClick={() => {
                        setOpen(null);
                        setFull(false);
                      }}
                    >
                      Collapse
                    </button>
                  </div>
                  {file && <Preview file={file} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {full && file && <PreviewFull file={file} onClose={() => setFull(false)} />}
    </div>
  );
}
