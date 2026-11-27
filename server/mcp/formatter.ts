import type { UpsertPlanResult } from '../db/queries';
import type { NodeStatus, NodeWithAncestors, PlanNode, ProjectTree } from '../types';

function renderSubtree(
  nodes: PlanNode[],
  lines: string[]
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, PlanNode[]>();
  const roots: PlanNode[] = [];

  for (const node of nodes) {
    if (node.parent_id && byId.has(node.parent_id)) {
      const list = childrenByParent.get(node.parent_id) ?? [];
      list.push(node);
      childrenByParent.set(node.parent_id, list);
    } else {
      roots.push(node);
    }
  }

  const visited = new Set<string>();

  const walk = (node: PlanNode, depth: number) => {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);

    const indent = '  '.repeat(depth);
    const children = childrenByParent.get(node.id) ?? [];
    const progressSuffix =
      node.node_type === 'module' && children.length > 0
        ? ` (${children.filter((c) => c.status === 'done').length}/${children.length} done)`
        : '';
    lines.push(
      `${indent}- [${node.status}] (${node.node_type}) ${node.title}${progressSuffix} — id:${node.id}`
    );

    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }
}

/** Format the project tree as concise, AI-readable Markdown. */
export function formatProjectTree(tree: ProjectTree, statusFilter?: NodeStatus): string {
  const lines: string[] = [`# ${tree.project.name}`];

  if (tree.project.summary.trim()) {
    lines.push('', tree.project.summary.trim());
  }

  if (statusFilter) {
    lines.push('', `_Filtered by status: \`${statusFilter}\`_`);
  }

  const visibleNodes = statusFilter
    ? tree.nodes.filter((node) => node.status === statusFilter)
    : tree.nodes;

  if (visibleNodes.length === 0 && (statusFilter || tree.groups.length === 0)) {
    lines.push(
      '',
      statusFilter
        ? `_No nodes matching status \`${statusFilter}\`._`
        : '_No plan nodes yet._'
    );
    return lines.join('\n');
  }

  const knownGroupIds = new Set(tree.groups.map((g) => g.id));
  const nodesByGroup = new Map<string, PlanNode[]>();
  const ungrouped: PlanNode[] = [];

  for (const node of visibleNodes) {
    if (node.group_id && knownGroupIds.has(node.group_id)) {
      const list = nodesByGroup.get(node.group_id) ?? [];
      list.push(node);
      nodesByGroup.set(node.group_id, list);
    } else {
      ungrouped.push(node);
    }
  }

  for (const group of tree.groups) {
    const groupNodes = nodesByGroup.get(group.id) ?? [];
    if (statusFilter && groupNodes.length === 0) {
      continue;
    }
    lines.push('', `## ${group.name}`);
    if (groupNodes.length === 0) {
      lines.push('_No nodes in this group._');
    } else {
      renderSubtree(groupNodes, lines);
    }
  }

  if (ungrouped.length > 0) {
    lines.push('', '## Ungrouped');
    renderSubtree(ungrouped, lines);
  }

  return lines.join('\n');
}

/** Format a target node and its full ancestor chain (root down to parent) as Markdown. */
export function formatNodeContext(data: NodeWithAncestors): string {
  const { node, ancestors } = data;
  const lines: string[] = [
    `# ${node.title}`,
    `ID: \`${node.id}\` | Type: \`${node.node_type}\` | Status: \`${node.status}\``,
  ];

  if (ancestors.length > 0) {
    const pathNames = [...ancestors.map((a) => a.title), node.title].join(' > ');
    lines.push(`Path: ${pathNames}`);
    lines.push('', '## Inherited Ancestor Context');

    ancestors.forEach((ancestor, index) => {
      lines.push(
        '',
        `### ${index + 1}. ${ancestor.title} (${ancestor.node_type} — id:${ancestor.id})`
      );
      if (ancestor.description.trim()) {
        lines.push(ancestor.description.trim());
      }
      if (ancestor.scope_files.length > 0) {
        lines.push(
          `**Scope Files:** ${ancestor.scope_files.map((f) => `\`${f}\``).join(', ')}`
        );
      }
      if (ancestor.rules.trim()) {
        lines.push(`**Rules:** ${ancestor.rules.trim()}`);
      }
    });
  }

  lines.push('', '## Node Details');
  if (node.description.trim()) {
    lines.push('', node.description.trim());
  }

  lines.push('', '### Scope Files');
  if (node.scope_files.length > 0) {
    for (const file of node.scope_files) {
      lines.push(`- \`${file}\``);
    }
  } else {
    lines.push('_None specified._');
  }

  lines.push('', '### Rules');
  lines.push(node.rules.trim() ? node.rules.trim() : '_None specified._');

  lines.push('', '### Checklist');
  if (node.checklist.length > 0) {
    for (const item of node.checklist) {
      lines.push(`- [${item.checked ? 'x' : ' '}] ${item.text}`);
    }
  } else {
    lines.push('_No checklist items._');
  }

  if (node.review_history.length > 0) {
    const labelMap: Record<string, string> = {
      human_feedback: 'Human Feedback',
      ai_plan: 'AI Revision Plan',
      ai_report: 'AI Report',
      approved: 'Approved',
    };
    lines.push('', '### Review & Revision Timeline');
    node.review_history.forEach((entry, index) => {
      const label = labelMap[entry.type] ?? entry.type;
      lines.push(`${index + 1}. **${label}** (${entry.created_at}): ${entry.content}`);
    });
  } else if (node.ai_report.trim()) {
    lines.push('', '### AI Report', node.ai_report.trim());
  }

  if (node.human_feedback.trim()) {
    lines.push('', '### Active Human Feedback', node.human_feedback.trim());
  }

  return lines.join('\n');
}

/** Format upsert_plan results as concise Markdown, with a gentle depth warning if > 3 levels. */
export function formatUpsertPlanResult(result: UpsertPlanResult): string {
  const lines: string[] = [
    `# Plan Upserted — ${result.group.name}`,
    `Created: ${result.created.length} | Updated: ${result.updated.length}`,
  ];

  if (result.created.length > 0) {
    lines.push('', '## Created');
    for (const node of result.created) {
      lines.push(`- (${node.node_type}) ${node.title} — id:${node.id}`);
    }
  }

  if (result.updated.length > 0) {
    lines.push('', '## Updated');
    for (const node of result.updated) {
      lines.push(`- (${node.node_type}) ${node.title} — id:${node.id}`);
    }
  }

  if (result.maxNonRevisionDepth > 3) {
    lines.push(
      '',
      `> Note: Non-revision nesting reached ${result.maxNonRevisionDepth} levels. Recommended soft limit is 3 levels (module -> submodule -> task) for clarity.`
    );
  }

  return lines.join('\n');
}

/** Format submit_for_review confirmation as Markdown. */
export function formatSubmitForReviewResult(node: PlanNode): string {
  const lines = [
    `# Submitted for Review — ${node.title}`,
    `Node \`${node.id}\` is now \`${node.status}\` and awaiting human verification.`,
  ];

  if (node.checklist.length > 0) {
    const checkedCount = node.checklist.filter((item) => item.checked).length;
    lines.push(`Checklist: ${checkedCount}/${node.checklist.length} completed.`);
  }

  return lines.join('\n');
}

/** Format add_revision confirmation as Markdown. */
export function formatAddRevisionResult(revision: PlanNode, parent: PlanNode): string {
  return [
    `# Revision Created — ${revision.title}`,
    `- Revision ID: \`${revision.id}\``,
    `- Status: \`${revision.status}\``,
    `- Parent: ${parent.title} (\`${parent.id}\`)`,
  ].join('\n');
}
