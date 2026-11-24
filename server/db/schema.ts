import type { Database } from 'bun:sqlite';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('module', 'task', 'revision')),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'needs_review', 'done')),
  scope_files TEXT NOT NULL DEFAULT '[]',
  rules TEXT DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '[]',
  ai_report TEXT DEFAULT '',
  human_feedback TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
`;

/** Initialize idempotent SQLite tables and indexes. */
export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}
