import type { HealthDetail } from '@claude-remote/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Brand, Problem } from './components/Bits.js';
import { Home } from './screens/Home.js';

export function App() {
  const [detail, setDetail] = useState<HealthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.healthDetail());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach the server.');
    }
  }, []);

  useEffect(() => {
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

  if (!detail) {
    return (
      <div className="home">
        <div className="card">
          <Brand />
          <p className="note">Checking&hellip;</p>
        </div>
      </div>
    );
  }

  return <Home detail={detail} />;
}
