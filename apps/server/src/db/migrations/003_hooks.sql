-- What Claude Code tells us about itself.
--
-- Status is derived from hooks, never from reading the terminal. If a hook
-- cannot tell us something, we do not display it — a regular expression over a
-- TUI could not honestly promise the "never ambiguous" that scope P6 asks for.

ALTER TABLE sessions ADD COLUMN claude_session_id TEXT;
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'starting';
ALTER TABLE sessions ADD COLUMN status_at TEXT;
-- Short human phrase for the card: "editing config.ts", "waiting on you".
ALTER TABLE sessions ADD COLUMN doing TEXT;

-- Every hook we were sent, in order. Small and append-only; the Changes tab
-- and the activity log both read from here later.
CREATE TABLE session_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  event      TEXT NOT NULL,
  tool       TEXT,
  -- The hook payload, trimmed. Free-form because hooks differ by event.
  detail     TEXT
);

CREATE INDEX session_events_session_idx ON session_events (session_id, id DESC);
