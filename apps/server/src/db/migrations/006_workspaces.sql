-- Workspaces, and the projects inside them.
--
-- Projects used to be declared in the environment as PROJECTS=name=path pairs,
-- which meant adding one was an edit-and-restart. They live here instead: a
-- workspace groups N projects, and both are created from the UI.
--
-- What did not change is the guarantee that made the env list defensible — a
-- session can still only start in a folder someone named on purpose. The list
-- is just kept somewhere a running server can add to. Every path is still
-- checked before it is stored, and re-checked when it is used.

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- Absolute, and stored as it resolved when it was added. Checked again on
  -- every use: a folder can be renamed or deleted after the fact.
  path         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- The same folder twice in one workspace is a mistake, not a feature.
  UNIQUE (workspace_id, path)
);

CREATE INDEX projects_workspace_idx ON projects (workspace_id);

-- Sessions carry a project_id and deliberately have no foreign key to it.
-- Rows outlive the work they describe — a finished session is still readable —
-- and removing a project from a workspace should not erase the history of what
-- was done in it.
