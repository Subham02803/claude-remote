import type { AuthStatus, TotpEnrolment } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Brand, Problem } from './components/Bits.js';
import { AuthLayout } from './screens/AuthLayout.js';
import { Code } from './screens/Code.js';
import { Home } from './screens/Home.js';
import { Identity } from './screens/Identity.js';
import { SetupIdentity } from './screens/SetupIdentity.js';
import { SetupToken } from './screens/SetupToken.js';

/** Reasons Google can hand back, in words rather than error codes. */
const OAUTH_PROBLEMS: Record<string, string> = {
  not_allowed: 'That Google account is not the one this installation allows.',
  email_unverified: 'That Google account has no verified email address.',
  stale_request: 'That sign-in attempt expired. Try again.',
  setup_required: 'Enter the setup token first.',
  already_claimed: 'This installation already has an owner.',
  access_denied: 'You cancelled the Google sign-in.',
  exchange_failed: 'Google would not complete the sign-in. Check the client ID and secret.',
  google_not_configured: 'Google sign-in is not configured on the server.',
  missing_code: 'Google did not send a sign-in code back.',
};

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [oauthProblem, setOauthProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      if (next.enrolment) setEnrolment(next.enrolment);
      if (next.step === 'ready') setEnrolment(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach the server.');
    }
  }, []);

  useEffect(() => {
    // The Google round trip comes back as a redirect, so any complaint arrives
    // in the query string. Read it once, then clean the address bar.
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('error');
    if (reason) {
      setOauthProblem(OAUTH_PROBLEMS[reason] ?? `Google sign-in failed (${reason}).`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="home">
        <div className="card">
          <Brand />
          <h1>Cannot reach the server</h1>
          <Problem>{error}</Problem>
          <p className="note">
            Start it with <code>pnpm dev</code> from the repo root, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="home">
        <div className="card">
          <Brand />
          <p className="note">Checking&hellip;</p>
        </div>
      </div>
    );
  }

  if (status.step === 'ready' && status.user) {
    return <Home user={status.user} onSignedOut={() => void refresh()} />;
  }

  return (
    <AuthLayout>
      {oauthProblem && <Problem>{oauthProblem}</Problem>}
      {status.step === 'setup-token' && <SetupToken onDone={() => void refresh()} />}
      {status.step === 'setup-identity' && (
        <SetupIdentity
          mode={status.mode}
          onEnrolled={(e) => {
            setEnrolment(e);
            void refresh();
          }}
        />
      )}
      {status.step === 'setup-totp' && (
        <Code enrolment={enrolment ?? status.enrolment} onDone={() => void refresh()} />
      )}
      {status.step === 'identity' && <Identity mode={status.mode} onDone={() => void refresh()} />}
      {status.step === 'totp' && (
        <Code lockedOutSeconds={status.lockedOutSeconds} onDone={() => void refresh()} />
      )}
    </AuthLayout>
  );
}
