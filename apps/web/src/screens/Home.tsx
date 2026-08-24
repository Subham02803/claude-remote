import type { HealthDetail } from '@claude-remote/shared';
import { Brand } from '../components/Bits.js';

/**
 * Placeholder for the workspace. It exists so that "the server is up and this
 * browser can talk to it" is visible at a glance; the projects and sessions
 * this becomes are the next step.
 */
export function Home({ detail }: { detail: HealthDetail }) {
  return (
    <div className="home">
      <div className="card">
        <Brand />
        <h1>Connected</h1>
        <p className="note">
          v{detail.version} · up {detail.uptimeSeconds}s
        </p>

        <div className="rows">
          <span className="label">Reached at</span>
          <p className="mono" style={{ fontSize: 12 }}>
            {window.location.host}
          </p>

          <span className="label">Server bound to</span>
          <p className="mono" style={{ fontSize: 12 }}>
            {detail.bind.host}:{detail.bind.port}
          </p>
        </div>

        {detail.warnings.length > 0 && (
          <div className="rows">
            <span className="label">Warnings</span>
            {detail.warnings.map((w) => (
              <p className="note" key={w}>
                {w}
              </p>
            ))}
          </div>
        )}

        <p className="note">
          Next: projects, sessions, and the terminal. This screen is a placeholder for the
          workspace.
        </p>
      </div>
    </div>
  );
}
