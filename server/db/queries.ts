import type { Database } from 'bun:sqlite';
import { db } from './client';
import { deriveModuleStatus } from './schema';
import type {
  ChecklistItem,
  Group,
  NodeRow,
  NodeStatus,
  NodeType,
  NodeWithAncestors,
  PlanNode,
  Project,
  ProjectExportBundle,
  ProjectTree,
  ReviewHistoryEntry,
  ReviewHistoryType,
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
    review_history: parseJsonArray<ReviewHistoryEntry>(row.review_history ?? '[]', []),
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
         review_history, sort_order, created_at, updated_at, depth
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
  review_history?: ReviewHistoryEntry[];
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
        $reviewHistory: string;
        $sortOrder: number;
        $createdAt: string;
        $updatedAt: string;
      }
    >(
      `INSERT INTO nodes (
         id, project_id, group_id, parent_id, node_type, title, description,
         status, scope_files, rules, checklist, ai_report, human_feedback,
         review_history, sort_order, created_at, updated_at
       ) VALUES (
         $id, $projectId, $groupId, $parentId, $nodeType, $title, $description,
         $status, $scopeFiles, $rules, $checklist, $aiReport, $humanFeedback,
         $reviewHistory, $sortOrder, $createdAt, $updatedAt
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
      $reviewHistory: JSON.stringify(input.review_history ?? []),
      $sortOrder: sortOrder,
      $createdAt: now,
      $updatedAt: now,
    });

  if (input.parent_id) {
    rollupAncestorModuleStatuses(projectId, input.parent_id, database);
  }
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
  review_history?: ReviewHistoryEntry[];
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
        $reviewHistory: string;
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
         review_history = $reviewHistory,
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
      $reviewHistory: JSON.stringify(patch.review_history ?? existing.review_history),
      $sortOrder: patch.sort_order ?? existing.sort_order,
      $updatedAt: now,
    });

  const nextParentId =
    patch.parent_id !== undefined ? patch.parent_id : existing.parent_id;

  if (patch.status !== undefined || patch.parent_id !== undefined) {
    rollupAncestorModuleStatuses(projectId, nextParentId, database);
    if (existing.parent_id && existing.parent_id !== nextParentId) {
      rollupAncestorModuleStatuses(projectId, existing.parent_id, database);
    }
  }

  touchProject(projectId, database);
  return getNodeById(projectId, nodeId, database);
}

/** Recompute status for every ancestor module bottom-up from startParentId. */
export function rollupAncestorModuleStatuses(
  projectId: string,
  startParentId: string | null,
  database: Database = db
): void {
  let currentParentId = startParentId;
  const visited = new Set<string>();

  while (currentParentId && !visited.has(currentParentId) && visited.size < 100) {
    visited.add(currentParentId);
    const parent = getNodeById(projectId, currentParentId, database);
    if (!parent) {
      break;
    }

    if (parent.node_type === 'module') {
      const childRows = database
        .query<{ status: NodeStatus }, { $projectId: string; $parentId: string }>(
          'SELECT status FROM nodes WHERE project_id = $projectId AND parent_id = $parentId'
        )
        .all({ $projectId: projectId, $parentId: parent.id });

      if (childRows.length > 0) {
        const derived = deriveModuleStatus(childRows.map((r) => r.status));
        if (derived !== parent.status) {
          database
            .query<
              unknown,
              { $id: string; $projectId: string; $status: NodeStatus; $updatedAt: string }
            >(
              `UPDATE nodes
               SET status = $status, updated_at = $updatedAt
               WHERE id = $id AND project_id = $projectId`
            )
            .run({
              $id: parent.id,
              $projectId: projectId,
              $status: derived,
              $updatedAt: nowIso(),
            });
        }
      }
    }

    currentParentId = parent.parent_id;
  }
}

function appendHistoryEntry(
  history: ReviewHistoryEntry[],
  type: ReviewHistoryType,
  content: string,
  createdAt = nowIso()
): ReviewHistoryEntry[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return history;
  }
  const last = history[history.length - 1];
  if (last && last.type === type && last.content === trimmed) {
    return history;
  }
  return [
    ...history,
    {
      id: crypto.randomUUID(),
      type,
      content: trimmed,
      created_at: createdAt,
    },
  ];
}

export function syncPatchedHumanFeedback(
  existingHistory: ReviewHistoryEntry[],
  nextFeedback: string,
  timestamp = nowIso()
): ReviewHistoryEntry[] {
  const trimmed = nextFeedback.trim();
  if (!trimmed) {
    return existingHistory;
  }
  const last = existingHistory[existingHistory.length - 1];
  if (last && last.type === 'human_feedback') {
    return [
      ...existingHistory.slice(0, -1),
      { ...last, content: trimmed, created_at: timestamp },
    ];
  }
  return appendHistoryEntry(existingHistory, 'human_feedback', trimmed, timestamp);
}

export function requestRevisionOnNode(
  projectId: string,
  nodeId: string,
  humanFeedback: string,
  database: Database = db
): PlanNode | null {
  const existing = getNodeById(projectId, nodeId, database);
  if (!existing) {
    return null;
  }
  const trimmed = humanFeedback.trim();
  const nextHistory = appendHistoryEntry(
    existing.review_history,
    'human_feedback',
    trimmed
  );
  return updateNode(
    projectId,
    nodeId,
    {
      human_feedback: trimmed,
      status: 'in_progress',
      review_history: nextHistory,
    },
    database
  );
}

export function approveNodeById(
  projectId: string,
  nodeId: string,
  comment?: string,
  database: Database = db
): PlanNode | null {
  const existing = getNodeById(projectId, nodeId, database);
  if (!existing) {
    return null;
  }
  const nextHistory = appendHistoryEntry(
    existing.review_history,
    'approved',
    comment?.trim() || 'Approved (Done)'
  );
  return updateNode(
    projectId,
    nodeId,
    {
      status: 'done',
      human_feedback: '',
      review_history: nextHistory,
    },
    database
  );
}

export function startNodeExecution(
  projectId: string,
  nodeId: string,
  revisionPlan?: string,
  database: Database = db
): PlanNode | null {
  const existing = getNodeById(projectId, nodeId, database);
  if (!existing) {
    return null;
  }
  const nextHistory = revisionPlan?.trim()
    ? appendHistoryEntry(existing.review_history, 'ai_plan', revisionPlan)
    : existing.review_history;
  return updateNode(
    projectId,
    nodeId,
    {
      status: 'in_progress',
      review_history: nextHistory,
    },
    database
  );
}

export function submitNodeForReview(
  projectId: string,
  nodeId: string,
  input: {
    ai_report: string;
    revision_plan?: string;
    checked_items?: string[];
  },
  database: Database = db
): PlanNode | null {
  const existing = getNodeById(projectId, nodeId, database);
  if (!existing) {
    return null;
  }

  const targets = new Set(
    (input.checked_items ?? []).map((entry) => entry.trim().toLowerCase())
  );
  const nextChecklist = existing.checklist.map((item, idx) => {
    if (item.checked) {
      return item;
    }
    const matched =
      targets.has(String(idx)) || targets.has(item.text.trim().toLowerCase());
    return matched ? { ...item, checked: true } : item;
  });

  const now = nowIso();
  let nextHistory = input.revision_plan?.trim()
    ? appendHistoryEntry(existing.review_history, 'ai_plan', input.revision_plan, now)
    : existing.review_history;
  nextHistory = appendHistoryEntry(nextHistory, 'ai_report', input.ai_report, now);

  return updateNode(
    projectId,
    nodeId,
    {
      status: 'needs_review',
      ai_report: input.ai_report,
      human_feedback: '',
      checklist: nextChecklist,
      review_history: nextHistory,
    },
    database
  );
}

export function deleteNode(
  projectId: string,
  nodeId: string,
  database: Database = db
): boolean {
  const existing = getNodeById(projectId, nodeId, database);
  const result = database
    .query<unknown, { $id: string; $projectId: string }>(
      'DELETE FROM nodes WHERE id = $id AND project_id = $projectId'
    )
    .run({ $id: nodeId, $projectId: projectId });

  if (result.changes > 0) {
    if (existing?.parent_id) {
      rollupAncestorModuleStatuses(projectId, existing.parent_id, database);
    }
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
          const addressedPlanFeedback =
            existing.status === 'planned' &&
            existing.human_feedback.trim().length > 0 &&
            item.description !== undefined &&
            item.description !== existing.description;
          const nextHistory = addressedPlanFeedback
            ? appendHistoryEntry(existing.review_history, 'ai_plan', item.description!)
            : existing.review_history;

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
              human_feedback: addressedPlanFeedback ? '' : existing.human_feedback,
              review_history: nextHistory,
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

/** Export a single project's full tree, checklist states, and review timeline as a portable bundle. */
export function exportProjectBundle(
  projectId: string,
  database: Database = db
): ProjectExportBundle | null {
  const tree = getProjectTree(projectId, database);
  if (!tree) {
    return null;
  }

  return {
    format: 'vibedeck-project-export',
    schema_version: 1,
    app_version: '0.1.2',
    exported_at: nowIso(),
    project: tree.project,
    groups: tree.groups,
    nodes: tree.nodes,
  };
}

export interface ImportProjectResult {
  project: Project;
  imported_groups: number;
  imported_nodes: number;
  id_remapped: boolean;
}

/** Import a project export bundle atomically, preserving IDs when free or remapping on collision. */
export function importProjectBundle(
  bundle: ProjectExportBundle,
  database: Database = db
): ImportProjectResult {
  const run = database.transaction((): ImportProjectResult => {
    const now = nowIso();
    let idRemapped = false;

    const requestedProjectId = bundle.project.id?.trim();
    let targetProjectId: string;
    if (requestedProjectId && !getProjectById(requestedProjectId, database)) {
      targetProjectId = requestedProjectId;
    } else {
      targetProjectId = crypto.randomUUID();
      if (requestedProjectId) {
        idRemapped = true;
      }
    }

    database
      .query<
        unknown,
        {
          $id: string;
          $name: string;
          $summary: string;
          $createdAt: string;
          $updatedAt: string;
        }
      >(
        `INSERT INTO projects (id, name, summary, created_at, updated_at)
         VALUES ($id, $name, $summary, $createdAt, $updatedAt)`
      )
      .run({
        $id: targetProjectId,
        $name: bundle.project.name,
        $summary: bundle.project.summary ?? '',
        $createdAt: bundle.project.created_at ?? now,
        $updatedAt: bundle.project.updated_at ?? now,
      });

    const groupExistsStmt = database.prepare<{ found: number }, { $id: string }>(
      'SELECT 1 AS found FROM groups WHERE id = $id LIMIT 1'
    );
    const insertGroupStmt = database.prepare<
      unknown,
      {
        $id: string;
        $projectId: string;
        $name: string;
        $sortOrder: number;
        $createdAt: string;
      }
    >(
      `INSERT INTO groups (id, project_id, name, sort_order, created_at)
       VALUES ($id, $projectId, $name, $sortOrder, $createdAt)`
    );

    const groupIdMap = new Map<string, string>();
    try {
      for (const group of bundle.groups) {
        const collision = Boolean(groupExistsStmt.get({ $id: group.id }));
        const targetGroupId =
          !idRemapped && !collision ? group.id : crypto.randomUUID();
        if (targetGroupId !== group.id) {
          idRemapped = true;
        }
        groupIdMap.set(group.id, targetGroupId);
        insertGroupStmt.run({
          $id: targetGroupId,
          $projectId: targetProjectId,
          $name: group.name,
          $sortOrder: group.sort_order ?? 0,
          $createdAt: group.created_at ?? now,
        });
      }
    } finally {
      groupExistsStmt.finalize();
      insertGroupStmt.finalize();
    }

    const nodeExistsStmt = database.prepare<{ found: number }, { $id: string }>(
      'SELECT 1 AS found FROM nodes WHERE id = $id LIMIT 1'
    );
    const insertNodeStmt = database.prepare<
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
        $reviewHistory: string;
        $sortOrder: number;
        $createdAt: string;
        $updatedAt: string;
      }
    >(
      `INSERT INTO nodes (
         id, project_id, group_id, parent_id, node_type, title, description,
         status, scope_files, rules, checklist, ai_report, human_feedback,
         review_history, sort_order, created_at, updated_at
       ) VALUES (
         $id, $projectId, $groupId, $parentId, $nodeType, $title, $description,
         $status, $scopeFiles, $rules, $checklist, $aiReport, $humanFeedback,
         $reviewHistory, $sortOrder, $createdAt, $updatedAt
       )`
    );

    const nodeIdMap = new Map<string, string>();
    try {
      for (const node of bundle.nodes) {
        const collision = Boolean(nodeExistsStmt.get({ $id: node.id }));
        const targetNodeId =
          !idRemapped && !collision ? node.id : crypto.randomUUID();
        if (targetNodeId !== node.id) {
          idRemapped = true;
        }
        nodeIdMap.set(node.id, targetNodeId);
      }

      const insertedOldIds = new Set<string>();
      let pending = [...bundle.nodes];

      while (pending.length > 0) {
        const ready: typeof pending = [];
        const deferred: typeof pending = [];

        for (const node of pending) {
          if (
            node.parent_id === null ||
            !nodeIdMap.has(node.parent_id) ||
            insertedOldIds.has(node.parent_id)
          ) {
            ready.push(node);
          } else {
            deferred.push(node);
          }
        }

        if (ready.length === 0) {
          ready.push(deferred.shift()!);
        }

        for (const node of ready) {
          const targetNodeId = nodeIdMap.get(node.id)!;
          const targetGroupId = node.group_id
            ? (groupIdMap.get(node.group_id) ?? null)
            : null;
          const targetParentId =
            node.parent_id &&
            nodeIdMap.has(node.parent_id) &&
            insertedOldIds.has(node.parent_id)
              ? nodeIdMap.get(node.parent_id)!
              : null;

          insertNodeStmt.run({
            $id: targetNodeId,
            $projectId: targetProjectId,
            $groupId: targetGroupId,
            $parentId: targetParentId,
            $nodeType: node.node_type,
            $title: node.title,
            $description: node.description ?? '',
            $status: node.status ?? 'planned',
            $scopeFiles: JSON.stringify(node.scope_files ?? []),
            $rules: node.rules ?? '',
            $checklist: JSON.stringify(node.checklist ?? []),
            $aiReport: node.ai_report ?? '',
            $humanFeedback: node.human_feedback ?? '',
            $reviewHistory: JSON.stringify(node.review_history ?? []),
            $sortOrder: node.sort_order ?? 0,
            $createdAt: node.created_at ?? now,
            $updatedAt: node.updated_at ?? now,
          });
          insertedOldIds.add(node.id);
        }

        pending = deferred;
      }
    } finally {
      nodeExistsStmt.finalize();
      insertNodeStmt.finalize();
    }

    return {
      project: getProjectById(targetProjectId, database)!,
      imported_groups: bundle.groups.length,
      imported_nodes: bundle.nodes.length,
      id_remapped: idRemapped,
    };
  });

  return run();
}
