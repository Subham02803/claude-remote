-- Foundational tables. Authentication tables arrive in their own migration.

-- Small key/value store for installation-level facts.
CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only record of anything worth being able to look back on: sign-ins,
-- revoked devices, approvals given, sessions stopped. Written by every layer,
-- owned by none of them, so it lives here rather than with authentication.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  event      TEXT NOT NULL,
  actor      TEXT,
  -- Free-form JSON. Deliberately not a schema: events differ, and this is a log.
  detail     TEXT,
  ip         TEXT,
  user_agent TEXT
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_event_idx ON audit_log (event, at DESC);
