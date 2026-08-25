import { useEffect, useState } from 'react';
import { SessionView } from './screens/SessionView.js';
import { Workspace } from './screens/Workspace.js';

/** The session id in the URL, or null for the overview. */
function readRoute(): string | null {
  const m = window.location.pathname.match(/^\/terminal\/([A-Za-z0-9_-]+)$/);
  return m ? (m[1] ?? null) : null;
}

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(readRoute);

  // Real URLs, so the back button works and a session can be bookmarked or
  // sent to another device — which is most of what device handoff needs.
  useEffect(() => {
    const onPop = () => setSessionId(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function open(id: string) {
    window.history.pushState({}, '', `/terminal/${id}`);
    setSessionId(id);
  }

  function back() {
    window.history.pushState({}, '', '/');
    setSessionId(null);
  }

  if (sessionId) return <SessionView id={sessionId} onBack={back} />;
  return <Workspace onOpen={open} />;
}
