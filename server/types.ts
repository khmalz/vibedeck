import { z } from 'zod';

export const NodeTypeSchema = z.enum(['module', 'task', 'revision']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const NodeStatusSchema = z.enum([
  'planned',
  'in_progress',
  'needs_review',
  'done',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const ChecklistItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ReviewHistoryTypeSchema = z.enum([
  'human_feedback',
  'ai_plan',
  'ai_report',
  'approved',
  'reopened',
]);
export type ReviewHistoryType = z.infer<typeof ReviewHistoryTypeSchema>;

export const ReviewHistoryEntrySchema = z.object({
  id: z.string(),
  type: ReviewHistoryTypeSchema,
  content: z.string(),
  created_at: z.string(),
});
export type ReviewHistoryEntry = z.infer<typeof ReviewHistoryEntrySchema>;

export interface Project {
  id: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface NodeRow {
  id: string;
  project_id: string;
  group_id: string | null;
  parent_id: string | null;
  node_type: NodeType;
  title: string;
  description: string;
  status: NodeStatus;
  previous_status: NodeStatus | null;
  scope_files: string;
  rules: string;
  checklist: string;
  ai_report: string;
  human_feedback: string;
  review_history: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlanNode {
  id: string;
  project_id: string;
  group_id: string | null;
  parent_id: string | null;
  node_type: NodeType;
  title: string;
  description: string;
  status: NodeStatus;
  previous_status: NodeStatus | null;
  scope_files: string[];
  rules: string;
  checklist: ChecklistItem[];
  ai_report: string;
  human_feedback: string;
  review_history: ReviewHistoryEntry[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NodeWithAncestors {
  node: PlanNode;
  ancestors: PlanNode[];
}

export interface ProjectTree {
  project: Project;
  groups: Group[];
  nodes: PlanNode[];
}

export interface UpsertPlanNodeInput {
  id?: string;
  node_type: NodeType;
  title: string;
  description?: string;
  scope_files?: string[];
  rules?: string;
  checklist?: string[];
  children?: UpsertPlanNodeInput[];
}

export const UpsertPlanNodeSchema: z.ZodType<UpsertPlanNodeInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1).optional(),
    node_type: NodeTypeSchema,
    title: z.string().min(1),
    description: z.string().optional(),
    scope_files: z.array(z.string()).optional(),
    rules: z.string().optional(),
    checklist: z.array(z.string()).optional(),
    children: z.array(UpsertPlanNodeSchema).optional(),
  })
);

export const UpsertPlanInputSchema = z.object({
  group_name: z.string().min(1),
  nodes: z.array(UpsertPlanNodeSchema),
});
export type UpsertPlanInput = z.infer<typeof UpsertPlanInputSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1),
  summary: z.string().optional().default(''),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(1),
  sort_order: z.number().int().optional(),
});
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export const PatchNodeSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  status: NodeStatusSchema.optional(),
  scope_files: z.array(z.string()).optional(),
  rules: z.string().optional(),
  checklist: z.array(ChecklistItemSchema).optional(),
  human_feedback: z.string().optional(),
});
export type PatchNodeInput = z.infer<typeof PatchNodeSchema>;

export const RequestRevisionSchema = z.object({
  human_feedback: z.string().trim().min(1),
});
export type RequestRevisionInput = z.infer<typeof RequestRevisionSchema>;

export const ApproveNodeSchema = z.object({
  comment: z.string().optional(),
});
export type ApproveNodeInput = z.infer<typeof ApproveNodeSchema>;

export const ReopenNodeSchema = z.object({
  reason: z.string().trim().optional(),
  cascade_scope: z.enum(['cascaded', 'all']).optional(),
});
export type ReopenNodeInput = z.infer<typeof ReopenNodeSchema>;

export const ProjectExportBundleSchema = z.object({
  format: z.literal('vibedeck-project-export'),
  schema_version: z.literal(1),
  app_version: z.string().optional(),
  exported_at: z.string().optional(),
  project: z.object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1),
    summary: z.string().optional().default(''),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  }),
  groups: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        sort_order: z.number().int().optional().default(0),
        created_at: z.string().optional(),
      })
    )
    .default([]),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        group_id: z.string().nullable().optional().default(null),
        parent_id: z.string().nullable().optional().default(null),
        node_type: NodeTypeSchema,
        title: z.string().trim().min(1),
        description: z.string().optional().default(''),
        status: NodeStatusSchema.optional().default('planned'),
        previous_status: NodeStatusSchema.nullable().optional().default(null),
        scope_files: z.array(z.string()).optional().default([]),
        rules: z.string().optional().default(''),
        checklist: z.array(ChecklistItemSchema).optional().default([]),
        ai_report: z.string().optional().default(''),
        human_feedback: z.string().optional().default(''),
        review_history: z.array(ReviewHistoryEntrySchema).optional().default([]),
        sort_order: z.number().int().optional().default(0),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
      })
    )
    .default([]),
});
export type ProjectExportBundle = z.infer<typeof ProjectExportBundleSchema>;
