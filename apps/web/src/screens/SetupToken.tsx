import { useState } from 'react';
import { ApiFailure, api } from '../api.js';
import { Problem } from '../components/Bits.js';

export function SetupToken({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.claimSetup(token.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'contents' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="step">Step 1 of 3 &middot; claim this machine</span>
        <h2>Nobody owns this yet</h2>
        <p className="note">
          A setup token was printed on the machine&rsquo;s own console when the server started.
          Paste it here. Needing it is what stops anyone else who finds this address from claiming
          the account.
        </p>
      </div>

      <label className="field">
        Setup token
        <input
          className="text mono"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="paste from the terminal"
          // biome-ignore lint/a11y/noAutofocus: the only thing to do on this screen is paste the token
          autoFocus
          spellCheck={false}
        />
      </label>

      {error && <Problem>{error}</Problem>}

      <button className="primary" type="submit" disabled={busy || token.trim().length < 8}>
        {busy ? 'Checking…' : 'Continue'}
      </button>

      <p className="note">
        Lost it? Stop the server, delete <code>data/claude-remote.db</code>, and start again.
      </p>
    </form>
  );
}
