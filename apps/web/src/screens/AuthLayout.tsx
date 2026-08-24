import type { ReactNode } from 'react';
import { Brand, Tick } from '../components/Bits.js';

const POINTS = [
  'Unblock a stalled run in one tap',
  'Queue more prompts onto a session that is already running',
  'Nothing runs in the cloud — the work stays on your own machine',
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__pitch">
        <span className="auth__glow" />
        <span className="auth__grid" />
        <div style={{ position: 'relative' }}>
          <Brand />
        </div>
        <div style={{ flexGrow: 1 }} />
        <h1 className="auth__lede">Your machine keeps working while you don&rsquo;t.</h1>
        <p className="auth__sub">
          Every project, every session, every agent &mdash; in a browser. Type into the same
          terminal you would sit in front of.
        </p>
        <div className="auth__points">
          {POINTS.map((p) => (
            <div className="auth__point" key={p}>
              <Tick />
              <span>{p}</span>
            </div>
          ))}
        </div>
        <div style={{ flexGrow: 1 }} />
        <span
          className="mono"
          style={{ position: 'relative', fontSize: 11.5, color: 'var(--ink-4)' }}
        >
          two layers &middot; identity then a code &nbsp;|&nbsp; one account only
        </span>
      </div>
      <div className="auth__panel">
        <div className="auth__card">{children}</div>
      </div>
    </div>
  );
}
