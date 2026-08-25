-- Sessions.
--
-- tmux is the source of truth for what exists; this table holds only what tmux
-- cannot: which project a session belongs to, what it is called, and which
-- device started it. On boot the two are reconciled — see session/store.ts.

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- The device it was started from, for UC-8. Free text, shown as-is.
  started_from  TEXT,
  -- Set when tmux no longer has the session. Rows are kept rather than deleted
  -- so a finished session can still be listed and read back.
  ended_at      TEXT
);

CREATE INDEX sessions_project_idx ON sessions (project_id);
CREATE INDEX sessions_live_idx ON sessions (ended_at);
