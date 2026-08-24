import type { HealthDetail } from '@claude-remote/shared';
import { useEffect, useState } from 'react';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; health: HealthDetail }
  | { state: 'error'; message: string };

const MODE_NOTE: Record<HealthDetail['authMode'], string> = {
  none: 'No sign-in required. Fine on this machine, never behind a tunnel.',
  local: 'A password you set, then a code from your authenticator.',
  google: 'Google sign-in, then a code from your authenticator.',
};

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/health/detail', { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server answered ${r.status}`);
        return (await r.json()) as HealthDetail;
      })
      .then((health) => setLoad({ state: 'ready', health }))
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ac.abort();
  }, []);

  return (
    <div className="wrap">
      <div className="card">
        <div className="brand">
          claude<span>·</span>remote
        </div>

        {load.state === 'loading' && <p className="note">Asking the server how it is…</p>}

        {load.state === 'error' && (
          <>
            <h1>Cannot reach the server</h1>
            <div className="err">{load.message}</div>
            <p className="note">
              Start it with <code>pnpm dev</code> from the repo root, then reload.
            </p>
          </>
        )}

        {load.state === 'ready' && (
          <>
            <h1>
              <span
                className="dot"
                style={{ background: 'var(--done)', marginRight: 10 }}
                aria-hidden
              />
              Server is up
            </h1>

            <div className="rows">
              <span className="label">Installation</span>
              <dl className="row">
                <dt>Version</dt>
                <dd>{load.health.version}</dd>
              </dl>
              <dl className="row">
                <dt>Listening on</dt>
                <dd>
                  {load.health.bind.host}:{load.health.bind.port}
                </dd>
              </dl>
              <dl className="row">
                <dt>Uptime</dt>
                <dd>{load.health.uptimeSeconds}s</dd>
              </dl>
              <dl className="row">
                <dt>Sign-in</dt>
                <dd>{load.health.authMode}</dd>
              </dl>
              <dl className="row">
                <dt>Tunnel URL</dt>
                <dd>{load.health.publicUrl ?? 'not configured'}</dd>
              </dl>
              <dl className="row">
                <dt>Database</dt>
                <dd>{load.health.database.migrationsApplied} migration(s) applied</dd>
              </dl>
            </div>

            <p className="note">{MODE_NOTE[load.health.authMode]}</p>

            {load.health.warnings.map((w) => (
              <div className="warn" key={w}>
                {w}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
