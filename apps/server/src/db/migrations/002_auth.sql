-- Authentication. One owner per installation, two layers to reach it.

-- The owner. Exactly one confirmed row is expected; the schema does not
-- enforce that, but the setup flow only ever creates one.
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  display_name      TEXT,
  -- scrypt digest, only used when AUTH_MODE=local
  password_hash     TEXT,
  -- TOTP secret, encrypted at rest with a key derived from SESSION_SECRET
  totp_secret       TEXT,
  -- Null until the first code from the authenticator has been accepted. A row
  -- without this is provisional: enrolment started but never finished.
  totp_confirmed_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at     TEXT
);

-- Browser sessions, held server side so that revoking one actually revokes it.
-- The raw token never lands here, only its digest.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  -- 'pending' once identity is proven, 'active' once the code is accepted.
  -- A pending session grants nothing beyond the chance to enter a code.
  stage        TEXT NOT NULL CHECK (stage IN ('pending', 'active')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- State for an OAuth round trip in flight. Rows are single use and short
-- lived; holding them server side is what makes the state parameter mean
-- anything.
CREATE TABLE oauth_flows (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  -- 1 when this round trip is claiming the account for the first time
  is_setup      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

-- Every attempt at either layer, successful or not. Drives lockout, and gives
-- the audit log something to point at.
CREATE TABLE auth_attempts (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  ip   TEXT,
  ok   INTEGER NOT NULL
);

CREATE INDEX auth_attempts_recent_idx ON auth_attempts (kind, at DESC);
