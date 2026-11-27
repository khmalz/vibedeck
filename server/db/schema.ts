import type { Database } from 'bun:sqlite';
import type { NodeStatus, ReviewHistoryEntry } from '../types';

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
  review_history TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
`;

interface LegacyNodeRow {
  id: string;
  status: NodeStatus;
  ai_report: string;
  human_feedback: string;
  created_at: string;
  updated_at: string;
}

/** Safely migrate v0.0.1 nodes tables lacking review_history and backfill existing entries. */
function migrateNodesReviewHistory(db: Database): void {
  const columns = db
    .query<{ name: string }, []>('PRAGMA table_info(nodes)')
    .all()
    .map((col) => col.name);

  if (columns.includes('review_history')) {
    return;
  }

  const runMigration = db.transaction(() => {
    db.exec("ALTER TABLE nodes ADD COLUMN review_history TEXT NOT NULL DEFAULT '[]';");

    const rows = db
      .query<LegacyNodeRow, []>(
        'SELECT id, status, ai_report, human_feedback, created_at, updated_at FROM nodes'
      )
      .all();

    const updateStmt = db.prepare<
      unknown,
      { $id: string; $reviewHistory: string; $humanFeedback: string }
    >(
      'UPDATE nodes SET review_history = $reviewHistory, human_feedback = $humanFeedback WHERE id = $id'
    );

    try {
      for (const row of rows) {
        const feedback = (row.human_feedback ?? '').trim();
        const report = (row.ai_report ?? '').trim();
        const history: ReviewHistoryEntry[] = [];
        let nextHumanFeedback = row.human_feedback ?? '';

        if (row.status === 'needs_review') {
          if (feedback) {
            history.push({
              id: crypto.randomUUID(),
              type: 'human_feedback',
              content: feedback,
              created_at: row.created_at,
            });
          }
          if (report) {
            history.push({
              id: crypto.randomUUID(),
              type: 'ai_report',
              content: report,
              created_at: row.updated_at,
            });
          }
          nextHumanFeedback = '';
        } else if (row.status === 'done') {
          if (feedback) {
            history.push({
              id: crypto.randomUUID(),
              type: 'human_feedback',
              content: feedback,
              created_at: row.created_at,
            });
          }
          if (report) {
            history.push({
              id: crypto.randomUUID(),
              type: 'ai_report',
              content: report,
              created_at: row.updated_at,
            });
          }
          history.push({
            id: crypto.randomUUID(),
            type: 'approved',
            content: 'Approved (Done)',
            created_at: row.updated_at,
          });
          nextHumanFeedback = '';
        } else {
          if (report) {
            history.push({
              id: crypto.randomUUID(),
              type: 'ai_report',
              content: report,
              created_at: row.created_at,
            });
          }
          if (feedback) {
            history.push({
              id: crypto.randomUUID(),
              type: 'human_feedback',
              content: feedback,
              created_at: row.updated_at,
            });
          }
        }

        updateStmt.run({
          $id: row.id,
          $reviewHistory: JSON.stringify(history),
          $humanFeedback: nextHumanFeedback,
        });
      }
    } finally {
      updateStmt.finalize();
    }
  });

  runMigration();
}

/** Derive a container module's status from its direct children's statuses. */
export function deriveModuleStatus(childStatuses: NodeStatus[]): NodeStatus {
  if (childStatuses.length === 0) {
    return 'planned';
  }
  if (childStatuses.every((s) => s === 'done')) {
    return 'done';
  }
  if (childStatuses.every((s) => s === 'planned')) {
    return 'planned';
  }
  if (childStatuses.some((s) => s === 'in_progress')) {
    return 'in_progress';
  }
  if (childStatuses.some((s) => s === 'needs_review')) {
    return 'needs_review';
  }
  return 'in_progress';
}

/** Reconcile stale module statuses from child statuses across existing databases. */
function syncModuleStatuses(db: Database): void {
  const selectModules = db.prepare<{ id: string; status: NodeStatus }, []>(
    "SELECT id, status FROM nodes WHERE node_type = 'module'"
  );
  const selectChildren = db.prepare<{ status: NodeStatus }, { $parentId: string }>(
    'SELECT status FROM nodes WHERE parent_id = $parentId'
  );
  const updateModule = db.prepare<
    unknown,
    { $id: string; $status: NodeStatus; $updatedAt: string }
  >('UPDATE nodes SET status = $status, updated_at = $updatedAt WHERE id = $id');

  const runSync = db.transaction(() => {
    const now = new Date().toISOString();
    for (let pass = 0; pass < 20; pass++) {
      let changed = false;
      const modules = selectModules.all();
      for (const mod of modules) {
        const children = selectChildren.all({ $parentId: mod.id });
        if (children.length === 0) {
          continue;
        }
        const derived = deriveModuleStatus(children.map((c) => c.status));
        if (derived !== mod.status) {
          updateModule.run({
            $id: mod.id,
            $status: derived,
            $updatedAt: now,
          });
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
  });

  try {
    runSync();
  } finally {
    selectModules.finalize();
    selectChildren.finalize();
    updateModule.finalize();
  }
}

/** Initialize idempotent SQLite tables, indexes, and backward-compatible migrations. */
export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
  migrateNodesReviewHistory(db);
  syncModuleStatuses(db);
}
