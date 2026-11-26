export type NodeType = 'module' | 'task' | 'revision';

export type NodeStatus = 'planned' | 'in_progress' | 'needs_review' | 'done';

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export type ReviewHistoryType =
  | 'human_feedback'
  | 'ai_plan'
  | 'ai_report'
  | 'approved';

export interface ReviewHistoryEntry {
  id: string;
  type: ReviewHistoryType;
  content: string;
  created_at: string;
}

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

export interface PlanNode {
  id: string;
  project_id: string;
  group_id: string | null;
  parent_id: string | null;
  node_type: NodeType;
  title: string;
  description: string;
  status: NodeStatus;
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

export interface ProjectTree {
  project: Project;
  groups: Group[];
  nodes: PlanNode[];
}

export type TreeViewMode = 'phase' | 'status';

export type SseConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface ProjectExportBundle {
  format: 'vibedeck-project-export';
  schema_version: 1;
  app_version?: string;
  exported_at?: string;
  project: {
    id?: string;
    name: string;
    summary?: string;
    created_at?: string;
    updated_at?: string;
  };
  groups: Array<{
    id: string;
    name: string;
    sort_order?: number;
    created_at?: string;
  }>;
  nodes: Array<{
    id: string;
    group_id: string | null;
    parent_id: string | null;
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
    created_at?: string;
    updated_at?: string;
  }>;
}

export interface ImportProjectResponse {
  project: Project;
  imported_groups: number;
  imported_nodes: number;
  id_remapped: boolean;
}
