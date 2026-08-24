import type { AuthMode } from '@claude-remote/shared';
import { useState } from 'react';
import { ApiFailure, api } from '../api.js';
import { Problem } from '../components/Bits.js';

export function Identity({ mode, onDone }: { mode: AuthMode; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'google') {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="step">Layer 1 of 2</span>
          <h2>Prove it&rsquo;s you</h2>
          <p className="note">Then a six-digit code from your authenticator.</p>
        </div>
        <a className="primary" href="/auth/google/start" style={{ textDecoration: 'none' }}>
          Continue with Google
        </a>
      </>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'contents' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="step">Layer 1 of 2</span>
        <h2>Prove it&rsquo;s you</h2>
        <p className="note">Then a six-digit code from your authenticator.</p>
      </div>

      <label className="field">
        Password
        <input
          className="text"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          // biome-ignore lint/a11y/noAutofocus: single-purpose sign-in form, first field is the only entry point
          autoFocus
          required
        />
      </label>

      {error && <Problem>{error}</Problem>}

      <button className="primary" type="submit" disabled={busy || !password}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </form>
  );
}
