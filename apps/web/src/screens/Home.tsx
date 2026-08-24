import type { DeviceSession, SessionUser } from '@claude-remote/shared';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Brand } from '../components/Bits.js';

function when(iso: string): string {
  const d = new Date(`${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Placeholder for the workspace. It exists so the end of sign-in is visible and
 * so device revocation has somewhere to live; the projects and sessions this
 * eventually becomes are the next step.
 */
export function Home({ user, onSignedOut }: { user: SessionUser; onSignedOut: () => void }) {
  const [devices, setDevices] = useState<DeviceSession[]>([]);

  useEffect(() => {
    api
      .devices()
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);

  return (
    <div className="home">
      <div className="card">
        <Brand />
        <h1>Signed in</h1>
        <p className="note">
          {user.displayName ? `${user.displayName} · ` : ''}
          {user.email}
        </p>

        <div className="rows">
          <span className="label">Browsers with access</span>
          {devices.map((d) => (
            <div className="device" key={d.id}>
              <span
                className="dot"
                style={{ background: d.current ? 'var(--done)' : 'var(--ink-4)' }}
                aria-hidden
              />
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>
                  {d.current ? 'This browser' : 'Another browser'}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {d.ip ?? 'unknown address'} · last seen {when(d.lastSeenAt)}
                </span>
              </span>
            </div>
          ))}
          {devices.length === 0 && <p className="note">Nothing to show.</p>}
        </div>

        <div style={{ display: 'flex', gap: 9 }}>
          <button
            className="secondary"
            type="button"
            onClick={() => void api.logout().then(onSignedOut)}
          >
            Sign out
          </button>
          <button
            className="secondary"
            type="button"
            style={{ borderColor: 'rgba(229,103,94,0.45)', color: 'var(--fail)' }}
            onClick={() => void api.logoutAll().then(onSignedOut)}
          >
            Lock all access
          </button>
        </div>

        <p className="note">
          Next: projects, sessions, and the terminal. This screen is a placeholder for the
          workspace.
        </p>
      </div>
    </div>
  );
}
