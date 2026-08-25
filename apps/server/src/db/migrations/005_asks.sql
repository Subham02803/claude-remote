-- The one open question a session is blocked on.
--
-- At most one per session: the screen shows one question, so the server holds
-- one. A second while the first is open is a bug, and treated as one.

CREATE TABLE asks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  tool         TEXT NOT NULL,
  -- What the tool was handed, as text. Shown in full: a truncated command is
  -- not something anyone can honestly approve.
  detail       TEXT NOT NULL,
  asked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- 'approved' | 'denied', and which device said so.
  answer       TEXT,
  answered_at  TEXT,
  answered_from TEXT
);

CREATE INDEX asks_open_idx ON asks (session_id, answered_at);
