import type { TotpEnrolment } from '@claude-remote/shared';
import { useState } from 'react';
import { ApiFailure, api } from '../api.js';
import { CodeInput, Problem } from '../components/Bits.js';

/**
 * The second layer, for both enrolling and signing in. Which one it is shows in
 * the copy; the request is the same either way, because the server already
 * knows whether this secret has been confirmed before.
 */
export function Code({
  enrolment,
  lockedOutSeconds,
  onDone,
}: {
  enrolment?: TotpEnrolment;
  lockedOutSeconds?: number;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const enrolling = !!enrolment;
  const locked = !!lockedOutSeconds;

  async function submit(value = code) {
    if (value.length !== 6 || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitCode(value, trust);
      onDone();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: 'contents' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="step">
          {enrolling ? 'Step 3 of 3 · your authenticator' : 'Layer 2 of 2'}
        </span>
        <h2>{enrolling ? 'Set up your authenticator' : 'Enter your code'}</h2>
        <p className="note">
          {enrolling
            ? 'Scan this with any authenticator app, then type the code it shows to finish.'
            : 'Six digits from your authenticator app.'}
        </p>
      </div>

      {enrolment && (
        <>
          <div className="qr">
            <img src={enrolment.qrDataUrl} alt="Authenticator QR code" width={220} height={220} />
          </div>
          {showSecret ? (
            <div className="secret">{enrolment.secret}</div>
          ) : (
            <button className="link" type="button" onClick={() => setShowSecret(true)}>
              No camera? Show the secret to type in by hand
            </button>
          )}
        </>
      )}

      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(v) => void submit(v)}
        disabled={busy || locked}
      />

      {locked && (
        <Problem>
          Too many wrong codes. Try again in about {Math.ceil((lockedOutSeconds ?? 0) / 60)}{' '}
          minutes.
        </Problem>
      )}
      {error && !locked && <Problem>{error}</Problem>}

      <button className="check" type="button" onClick={() => setTrust(!trust)}>
        <span className="check__box" data-on={trust}>
          {trust && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 18 18"
              fill="none"
              stroke="#12141A"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3.6 9.4 7 12.8l7.4-7.4" />
            </svg>
          )}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
            Trust this browser for 30 days
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
            so you&rsquo;re not doing this in a taxi
          </span>
        </span>
      </button>

      <button className="primary" type="submit" disabled={busy || locked || code.length !== 6}>
        {busy ? 'Checking…' : enrolling ? 'Finish setup' : 'Unlock'}
      </button>
    </form>
  );
}
