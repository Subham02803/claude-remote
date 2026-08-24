import type { AuthMode, TotpEnrolment } from '@claude-remote/shared';
import { useState } from 'react';
import { ApiFailure, api } from '../api.js';
import { Problem } from '../components/Bits.js';

export function SetupIdentity({
  mode,
  onEnrolled,
}: {
  mode: AuthMode;
  onEnrolled: (e: TotpEnrolment) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'google') {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="step">Step 2 of 3 &middot; who you are</span>
          <h2>Sign in with Google</h2>
          <p className="note">
            Only the address set as <code>ALLOWED_EMAIL</code> can claim this installation. Any
            other account is turned away.
          </p>
        </div>
        <a className="primary" href="/auth/google/start" style={{ textDecoration: 'none' }}>
          Continue with Google
        </a>
        <p className="note">
          Google tells this app who you are, once. It never gets to keep a token.
        </p>
      </>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { enrolment } = await api.setupLocal(email.trim(), password);
      onEnrolled(enrolment);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'contents' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="step">Step 2 of 3 &middot; who you are</span>
        <h2>Choose your sign-in</h2>
        <p className="note">This is the only account that will ever be able to sign in.</p>
      </div>

      <label className="field">
        Email
        <input
          className="text"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          // biome-ignore lint/a11y/noAutofocus: single-purpose sign-in form, first field is the only entry point
          autoFocus
          required
        />
      </label>

      <label className="field">
        Password
        <input
          className="text"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 10 characters"
          autoComplete="new-password"
          required
        />
      </label>

      {error && <Problem>{error}</Problem>}

      <button className="primary" type="submit" disabled={busy || password.length < 10 || !email}>
        {busy ? 'Setting up…' : 'Continue'}
      </button>
    </form>
  );
}
