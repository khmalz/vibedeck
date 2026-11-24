import type { Database } from 'bun:sqlite';
import { db } from './client';
import type {
  ChecklistItem,
  Group,
  NodeRow,
  NodeStatus,
  NodeType,
  NodeWithAncestors,
  PlanNode,
  Project,
  ProjectTree,
  UpsertPlanNodeInput,
} from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/** Convert a raw SQLite node row into a typed PlanNode with parsed JSON fields. */
export function parseNodeRow(row: NodeRow): PlanNode {
  return {
    ...row,
    description: row.description ?? '',
    rules: row.rules ?? '',
    ai_report: row.ai_report ?? '',
    human_feedback: row.human_feedback ?? '',
    scope_files: parseJsonArray<string>(row.scope_files, []),
    checklist: parseJsonArray<ChecklistItem>(row.checklist, []),
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(database: Database = db): Project[] {
  return database
    .query<Project, []>('SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC')
    .all();
}

export function getProjectById(projectId: string, database: Database = db): Project | null {
  return (
    database
      .query<Project, { $id: string }>('SELECT * FROM projects WHERE id = $id')
      .get({ $id: projectId }) ?? null
  );
}

export function createProject(
  input: { id?: string; name: string; summary?: string },
  database: Database = db
): Project {
  const id = input.id ?? crypto.randomUUID();
  const now = nowIso();
  const summary = input.summary ?? '';

  database
    .query<unknown, { $id: string; $name: string; $summary: string; $createdAt: string; $updatedAt: string }>(
      `INSERT INTO projects (id, name, summary, created_at, updated_at)
       VALUES ($id, $name, $summary, $createdAt, $updatedAt)`
    )
    .run({
      $id: id,
      $name: input.name,
      $summary: summary,
      $createdAt: now,
      $updatedAt: now,
    });

  return getProjectById(id, database)!;
}

export function deleteProject(projectId: string, database: Database = db): boolean {
  const result = database
    .query<unknown, { $id: string }>('DELETE FROM projects WHERE id = $id')
    .run({ $id: projectId });
  return result.changes > 0;
}

export function touchProject(projectId: string, database: Database = db): void {
  database
    .query<unknown, { $id: string; $updatedAt: string }>(
      'UPDATE projects SET updated_at = $updatedAt WHERE id = $id'
    )
    .run({ $id: projectId, $updatedAt: nowIso() });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function listGroupsByProject(projectId: string, database: Database = db): Group[] {
  return database
    .query<Group, { $projectId: string }>(
      'SELECT * FROM groups WHERE project_id = $projectId ORDER BY sort_order ASC, created_at ASC'
    )
    .all({ $projectId: projectId });
}

export function getGroupById(
  projectId: string,
  groupId: string,
  database: Database = db
): Group | null {
  return (
    database
      .query<Group, { $id: string; $projectId: string }>(
        'SELECT * FROM groups WHERE id = $id AND project_id = $projectId'
      )
      .get({ $id: groupId, $projectId: projectId }) ?? null
  );
}

export function createGroup(
  projectId: string,
  input: { id?: string; name: string; sort_order?: number },
  database: Database = db
): Group {
  const id = input.id ?? crypto.randomUUID();
  const now = nowIso();

  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const row = database
      .query<{ next_order: number }, { $projectId: string }>(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM groups WHERE project_id = $projectId'
      )
      .get({ $projectId: projectId });
    sortOrder = row?.next_order ?? 0;
  }

  database
    .query<
      unknown,
      { $id: string; $projectId: string; $name: string; $sortOrder: number; $createdAt: string }
    >(
      `INSERT INTO groups (id, project_id, name, sort_order, created_at)
       VALUES ($id, $projectId, $name, $sortOrder, $createdAt)`
    )
    .run({
      $id: id,
      $projectId: projectId,
      $name: input.name,
      $sortOrder: sortOrder,
      $createdAt: now,
    });

  touchProject(projectId, database);
  return getGroupById(projectId, id, database)!;
}

export function findOrCreateGroupByName(
  projectId: string,
  name: string,
  database: Database = db
): Group {
  const existing = database
    .query<Group, { $projectId: string; $name: string }>(
      'SELECT * FROM groups WHERE project_id = $projectId AND name = $name LIMIT 1'
    )
    .get({ $projectId: projectId, $name: name });

  if (existing) {
    return existing;
  }

  return createGroup(projectId, { name }, database);
}

export function deleteGroup(
  projectId: string,
  groupId: string,
  database: Database = db
): boolean {
  const result = database
    .query<unknown, { $id: string; $projectId: string }>(
      'DELETE FROM groups WHERE id = $id AND project_id = $projectId'
    )
    .run({ $id: groupId, $projectId: projectId });

  if (result.changes > 0) {
    touchProject(projectId, database);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Nodes & Tree
// ---------------------------------------------------------------------------

export function listNodesByProject(
  projectId: string,
  statusFilter?: NodeStatus,
  database: Database = db
): PlanNode[] {
  if (statusFilter) {
    const rows = database
      .query<NodeRow, { $projectId: string; $status: NodeStatus }>(
        `SELECT * FROM nodes
         WHERE project_id = $projectId AND status = $status
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all({ $projectId: projectId, $status: statusFilter });
    return rows.map(parseNodeRow);
  }

  const rows = database
    .query<NodeRow, { $projectId: string }>(
      `SELECT * FROM nodes
       WHERE project_id = $projectId
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all({ $projectId: projectId });
  return rows.map(parseNodeRow);
}

export function getProjectTree(
  projectId: string,
  database: Database = db
): ProjectTree | null {
  const project = getProjectById(projectId, database);
  if (!project) {
    return null;
  }

  return {
    project,
    groups: listGroupsByProject(projectId, database),
    nodes: listNodesByProject(projectId, undefined, database),
  };
}

export function getNodeById(
  projectId: string,
  nodeId: string,
  database: Database = db
): PlanNode | null {
  const row = database
    .query<NodeRow, { $id: string; $projectId: string }>(
      'SELECT * FROM nodes WHERE id = $id AND project_id = $projectId'
    )
    .get({ $id: nodeId, $projectId: projectId });

  return row ? parseNodeRow(row) : null;
}

/**
 * Fetch a node and its complete ancestor chain ordered from root down to immediate parent.
 * Strictly scoped to projectId so cross-project node IDs always return null.
 */
export function getNodeWithAncestors(
  projectId: string,
  nodeId: string,
  database: Database = db
): NodeWithAncestors | null {
  type LineageRow = NodeRow & { depth: number };

  const rows = database
    .query<LineageRow, { $nodeId: string; $projectId: string }>(
      `WITH RECURSIVE lineage AS (
         SELECT *, 0 AS depth
         FROM nodes
         WHERE id = $nodeId AND project_id = $projectId
         UNION ALL
         SELECT p.*, lineage.depth + 1 AS depth
         FROM nodes p
         INNER JOIN lineage ON p.id = lineage.parent_id
         WHERE p.project_id = $projectId AND lineage.depth < 100
       )
       SELECT
         id, project_id, group_id, parent_id, node_type, title, description,
         status, scope_files, rules, checklist, ai_report, human_feedback,
         sort_order, created_at, updated_at, depth
       FROM lineage
       ORDER BY depth DESC`
    )
    .all({ $nodeId: nodeId, $projectId: projectId });

  if (rows.length === 0) {
    return null;
  }

  const parsed = rows.map(({ depth: _depth, ...row }) => parseNodeRow(row));
  return {
    ancestors: parsed.slice(0, -1),
    node: parsed[parsed.length - 1]!,
  };
}

export interface CreateNodeInput {
  id?: string;
  group_id?: string | null;
  parent_id?: string | null;
  node_type: NodeType;
  title: string;
  description?: string;
  status?: NodeStatus;
  scope_files?: string[];
  rules?: string;
  checklist?: ChecklistItem[];
  ai_report?: string;
  human_feedback?: string;
  sort_order?: number;
}

export function createNode(
  projectId: string,
  input: CreateNodeInput,
  database: Database = db
): PlanNode {
  const id = input.id ?? crypto.randomUUID();
  const now = nowIso();

  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const row =
      input.parent_id !== undefined && input.parent_id !== null
        ? database
            .query<{ next_order: number }, { $projectId: string; $parentId: string }>(
              `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
               FROM nodes
               WHERE project_id = $projectId AND parent_id = $parentId`
            )
            .get({ $projectId: projectId, $parentId: input.parent_id })
        : database
            .query<{ next_order: number }, { $projectId: string }>(
              `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
               FROM nodes
               WHERE project_id = $projectId AND parent_id IS NULL`
            )
            .get({ $projectId: projectId });
    sortOrder = row?.next_order ?? 0;
  }

  database
    .query<
      unknown,
      {
        $id: string;
        $projectId: string;
        $groupId: string | null;
        $parentId: string | null;
        $nodeType: NodeType;
        $title: string;
        $description: string;
        $status: NodeStatus;
        $scopeFiles: string;
        $rules: string;
        $checklist: string;
        $aiReport: string;
        $humanFeedback: string;
        $sortOrder: number;
        $createdAt: string;
        $updatedAt: string;
      }
    >(
      `INSERT INTO nodes (
         id, project_id, group_id, parent_id, node_type, title, description,
         status, scope_files, rules, checklist, ai_report, human_feedback,
         sort_order, created_at, updated_at
       ) VALUES (
         $id, $projectId, $groupId, $parentId, $nodeType, $title, $description,
         $status, $scopeFiles, $rules, $checklist, $aiReport, $humanFeedback,
         $sortOrder, $createdAt, $updatedAt
       )`
    )
    .run({
      $id: id,
      $projectId: projectId,
      $groupId: input.group_id ?? null,
      $parentId: input.parent_id ?? null,
      $nodeType: input.node_type,
      $title: input.title,
      $description: input.description ?? '',
      $status: input.status ?? 'planned',
      $scopeFiles: JSON.stringify(input.scope_files ?? []),
      $rules: input.rules ?? '',
      $checklist: JSON.stringify(input.checklist ?? []),
      $aiReport: input.ai_report ?? '',
      $humanFeedback: input.human_feedback ?? '',
      $sortOrder: sortOrder,
      $createdAt: now,
      $updatedAt: now,
    });

  touchProject(projectId, database);
  return getNodeById(projectId, id, database)!;
}

export interface UpdateNodeInput {
  group_id?: string | null;
  parent_id?: string | null;
  node_type?: NodeType;
  title?: string;
  description?: string;
  status?: NodeStatus;
  scope_files?: string[];
  rules?: string;
  checklist?: ChecklistItem[];
  ai_report?: string;
  human_feedback?: string;
  sort_order?: number;
}

export function updateNode(
  projectId: string,
  nodeId: string,
  patch: UpdateNodeInput,
  database: Database = db
): PlanNode | null {
  const existing = getNodeById(projectId, nodeId, database);
  if (!existing) {
    return null;
  }

  const now = nowIso();
  database
    .query<
      unknown,
      {
        $id: string;
        $projectId: string;
        $groupId: string | null;
        $parentId: string | null;
        $nodeType: NodeType;
        $title: string;
        $description: string;
        $status: NodeStatus;
        $scopeFiles: string;
        $rules: string;
        $checklist: string;
        $aiReport: string;
        $humanFeedback: string;
        $sortOrder: number;
        $updatedAt: string;
      }
    >(
      `UPDATE nodes SET
         group_id = $groupId,
         parent_id = $parentId,
         node_type = $nodeType,
         title = $title,
         description = $description,
         status = $status,
         scope_files = $scopeFiles,
         rules = $rules,
         checklist = $checklist,
         ai_report = $aiReport,
         human_feedback = $humanFeedback,
         sort_order = $sortOrder,
         updated_at = $updatedAt
       WHERE id = $id AND project_id = $projectId`
    )
    .run({
      $id: nodeId,
      $projectId: projectId,
      $groupId: patch.group_id !== undefined ? patch.group_id : existing.group_id,
      $parentId: patch.parent_id !== undefined ? patch.parent_id : existing.parent_id,
      $nodeType: patch.node_type ?? existing.node_type,
      $title: patch.title ?? existing.title,
      $description: patch.description ?? existing.description,
      $status: patch.status ?? existing.status,
      $scopeFiles: JSON.stringify(patch.scope_files ?? existing.scope_files),
      $rules: patch.rules ?? existing.rules,
      $checklist: JSON.stringify(patch.checklist ?? existing.checklist),
      $aiReport: patch.ai_report ?? existing.ai_report,
      $humanFeedback: patch.human_feedback ?? existing.human_feedback,
      $sortOrder: patch.sort_order ?? existing.sort_order,
      $updatedAt: now,
    });

  touchProject(projectId, database);
  return getNodeById(projectId, nodeId, database);
}

export function deleteNode(
  projectId: string,
  nodeId: string,
  database: Database = db
): boolean {
  const result = database
    .query<unknown, { $id: string; $projectId: string }>(
      'DELETE FROM nodes WHERE id = $id AND project_id = $projectId'
    )
    .run({ $id: nodeId, $projectId: projectId });

  if (result.changes > 0) {
    touchProject(projectId, database);
    return true;
  }
  return false;
}

export interface UpsertPlanResult {
  group: Group;
  created: PlanNode[];
  updated: PlanNode[];
  maxNonRevisionDepth: number;
}

function mergeChecklist(
  items: string[] | undefined,
  existingChecklist?: ChecklistItem[]
): ChecklistItem[] {
  if (!items) {
    return existingChecklist ?? [];
  }
  const checkedByText = new Map(
    (existingChecklist ?? []).map((item) => [item.text, item.checked])
  );
  return items.map((text) => ({
    text,
    checked: checkedByText.get(text) ?? false,
  }));
}

/**
 * Recursively insert or update a plan tree inside a single synchronous SQLite transaction.
 * Existing node IDs are only updated if they belong to the target projectId.
 */
export function upsertPlan(
  projectId: string,
  groupName: string,
  nodes: UpsertPlanNodeInput[],
  database: Database = db
): UpsertPlanResult {
  const run = database.transaction((): UpsertPlanResult => {
    const group = findOrCreateGroupByName(projectId, groupName, database);
    const created: PlanNode[] = [];
    const updated: PlanNode[] = [];
    let maxNonRevisionDepth = 0;

    const visit = (
      items: UpsertPlanNodeInput[],
      parentId: string | null,
      nonRevisionDepth: number
    ) => {
      items.forEach((item, index) => {
        const nextDepth =
          item.node_type === 'revision' ? nonRevisionDepth : nonRevisionDepth + 1;
        if (item.node_type !== 'revision' && nextDepth > maxNonRevisionDepth) {
          maxNonRevisionDepth = nextDepth;
        }

        const existing = item.id
          ? getNodeById(projectId, item.id, database)
          : null;

        let saved: PlanNode;
        if (existing) {
          saved = updateNode(
            projectId,
            existing.id,
            {
              group_id: group.id,
              parent_id: parentId,
              node_type: item.node_type,
              title: item.title,
              description: item.description ?? existing.description,
              scope_files: item.scope_files ?? existing.scope_files,
              rules: item.rules ?? existing.rules,
              checklist:
                item.checklist !== undefined
                  ? mergeChecklist(item.checklist, existing.checklist)
                  : existing.checklist,
              sort_order: index,
            },
            database
          )!;
          updated.push(saved);
        } else {
          saved = createNode(
            projectId,
            {
              group_id: group.id,
              parent_id: parentId,
              node_type: item.node_type,
              title: item.title,
              description: item.description ?? '',
              scope_files: item.scope_files ?? [],
              rules: item.rules ?? '',
              checklist: mergeChecklist(item.checklist),
              sort_order: index,
            },
            database
          );
          created.push(saved);
        }

        if (item.children && item.children.length > 0) {
          visit(item.children, saved.id, nextDepth);
        }
      });
    };

    visit(nodes, null, 0);

    return {
      group,
      created,
      updated,
      maxNonRevisionDepth,
    };
  });

  return run();
}
