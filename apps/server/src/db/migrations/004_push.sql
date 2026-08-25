-- Devices to notify, and the keypair we sign pushes with.
--
-- Only two events ever push: blocked and failed. Scope §10 names notification
-- fatigue as a real risk, so that is a constraint in the code rather than a
-- setting someone can turn into noise.

CREATE TABLE push_subs (
  -- The push service's endpoint URL uniquely identifies a subscription.
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at TEXT,
  -- Set when the push service tells us the subscription is dead, so we stop
  -- trying rather than failing forever.
  gone_at     TEXT
);
