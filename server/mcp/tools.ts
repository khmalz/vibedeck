import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { db } from '../db/client';
import {
  createNode,
  getNodeById,
  getNodeWithAncestors,
  getProjectTree,
  startNodeExecution,
  submitNodeForReview,
  upsertPlan,
} from '../db/queries';
import { NodeStatusSchema, UpsertPlanInputSchema } from '../types';
import {
  formatAddRevisionResult,
  formatNodeContext,
  formatProjectTree,
  formatSubmitForReviewResult,
  formatUpsertPlanResult,
} from './formatter';

export interface McpToolOptions {
  db?: Database;
  onMutate?: (projectId: string) => void;
}

function textResult(text: string, isError = false) {
  return isError
    ? { content: [{ type: 'text' as const, text }], isError: true }
    : { content: [{ type: 'text' as const, text }] };
}

/** Register the 6 strictly project-scoped VibeDeck MCP tools on an McpServer instance. */
export function registerProjectTools(
  server: McpServer,
  projectId: string,
  options: McpToolOptions = {}
): void {
  const database = options.db ?? db;
  const notifyMutated = () => {
    options.onMutate?.(projectId);
  };

  server.registerTool(
    'get_project_tree',
    {
      title: 'Get Project Tree',
      description: 'Get the project summary, groups, and hierarchical plan tree with node IDs and statuses.',
      inputSchema: {
        status_filter: NodeStatusSchema.optional().describe(
          'Optional status filter (planned, in_progress, needs_review, done).'
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status_filter }) => {
      const tree = getProjectTree(projectId, database);
      if (!tree) {
        return textResult(`Project "${projectId}" not found.`, true);
      }
      return textResult(formatProjectTree(tree, status_filter));
    }
  );

  server.registerTool(
    'get_node_context',
    {
      title: 'Get Node Context',
      description:
        'Fetch full node details plus inherited ancestor chain (scope_files, rules, checklist, ai_report, human_feedback).',
      inputSchema: {
        node_id: z.string().min(1).describe('Target node ID within the current project.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node_id }) => {
      const context = getNodeWithAncestors(projectId, node_id, database);
      if (!context) {
        return textResult(`Node "${node_id}" not found in project "${projectId}".`, true);
      }
      return textResult(formatNodeContext(context));
    }
  );

  server.registerTool(
    'upsert_plan',
    {
      title: 'Upsert Plan',
      description:
        'Create or update a grouped hierarchical plan (module -> submodule -> task) inside a single transaction. Put each node\'s goal and step-by-step process in `description`.',
      inputSchema: UpsertPlanInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ group_name, nodes }) => {
      const result = upsertPlan(projectId, group_name, nodes, database);
      notifyMutated();
      return textResult(formatUpsertPlanResult(result));
    }
  );

  server.registerTool(
    'start_node',
    {
      title: 'Start Node',
      description:
        'Mark a node as in_progress and return its full context including inherited scope_files, rules, and human_feedback.',
      inputSchema: {
        node_id: z.string().min(1).describe('Node ID to start working on.'),
        revision_plan: z
          .string()
          .optional()
          .describe(
            'When revising work after human_feedback, describe your planned fix steps here so they appear in the UI Review Timeline while preserving the original Plan & Process.'
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node_id, revision_plan }) => {
      const updated = startNodeExecution(projectId, node_id, revision_plan, database);
      if (!updated) {
        return textResult(`Node "${node_id}" not found in project "${projectId}".`, true);
      }
      notifyMutated();
      const context = getNodeWithAncestors(projectId, node_id, database);
      if (!context) {
        return textResult(`Node "${node_id}" not found in project "${projectId}".`, true);
      }
      return textResult(formatNodeContext(context));
    }
  );

  server.registerTool(
    'submit_for_review',
    {
      title: 'Submit For Review',
      description:
        'Move a node to needs_review, save an AI completion report, and mark specified checklist items as checked.',
      inputSchema: {
        node_id: z.string().min(1).describe('Node ID to submit for human review.'),
        ai_report: z.string().min(1).describe('Concise Markdown summary of changes and verification.'),
        revision_plan: z
          .string()
          .optional()
          .describe('Optional revision plan summary if not already provided in start_node.'),
        checked_items: z
          .array(z.string())
          .optional()
          .describe('Checklist item texts or 0-based index strings (e.g. "0") to mark checked.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ node_id, ai_report, revision_plan, checked_items }) => {
      const updated = submitNodeForReview(
        projectId,
        node_id,
        { ai_report, revision_plan, checked_items },
        database
      );
      if (!updated) {
        return textResult(`Node "${node_id}" not found in project "${projectId}".`, true);
      }
      notifyMutated();
      return textResult(formatSubmitForReviewResult(updated));
    }
  );

  server.registerTool(
    'add_revision',
    {
      title: 'Add Revision',
      description:
        'Attach a new planned revision child node under an existing parent node, inheriting its group.',
      inputSchema: {
        parent_node_id: z.string().min(1).describe('Parent node ID to attach the revision under.'),
        title: z.string().min(1).describe('Short title for the revision.'),
        description: z.string().min(1).describe('Detailed description of the requested fix or revision.'),
        scope_files: z.array(z.string()).optional().describe('Optional files in scope for this revision.'),
        rules: z.string().optional().describe('Optional rules or constraints for this revision.'),
        checklist: z.array(z.string()).optional().describe('Optional checklist item strings.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ parent_node_id, title, description, scope_files, rules, checklist }) => {
      const parent = getNodeById(projectId, parent_node_id, database);
      if (!parent) {
        return textResult(
          `Parent node "${parent_node_id}" not found in project "${projectId}".`,
          true
        );
      }

      const revision = createNode(
        projectId,
        {
          group_id: parent.group_id,
          parent_id: parent.id,
          node_type: 'revision',
          title,
          description,
          status: 'planned',
          scope_files: scope_files ?? [],
          rules: rules ?? '',
          checklist: (checklist ?? []).map((text) => ({ text, checked: false })),
        },
        database
      );
      notifyMutated();
      return textResult(formatAddRevisionResult(revision, parent));
    }
  );
}
