import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Layers,
  Plug,
  Trash2,
} from 'lucide-react';
import type { Group, NodeStatus, PlanNode, Project, TreeViewMode } from '../types';
import { STATUS_META, TYPE_META, TreeNodeItem } from './TreeNodeItem';

interface FractalTreeProps {
  project: Project | null;
  groups: Group[];
  nodes: PlanNode[];
  loading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenAddProject: () => void;
  onOpenMcpConfig: () => void;
  onDeleteGroup: (groupId: string) => Promise<void>;
}

const STATUS_BUCKETS: Array<{ status: NodeStatus; title: string }> = [
  { status: 'in_progress', title: 'In Progress' },
  { status: 'needs_review', title: 'Needs Review' },
  { status: 'planned', title: 'Planned' },
  { status: 'done', title: 'Done' },
];

export function FractalTree({
  project,
  groups,
  nodes,
  loading,
  error,
  selectedNodeId,
  onSelectNode,
  onOpenAddProject,
  onOpenMcpConfig,
  onDeleteGroup,
}: FractalTreeProps) {
  const [viewMode, setViewMode] = useState<TreeViewMode>('phase');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(
    null
  );
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [collapsedStatusBuckets, setCollapsedStatusBuckets] = useState<
    Set<NodeStatus>
  >(() => new Set<NodeStatus>(['done']));

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<NodeStatus, number> = {
      in_progress: 0,
      needs_review: 0,
      planned: 0,
      done: 0,
    };
    for (const node of nodes) {
      counts[node.status] += 1;
    }
    return counts;
  }, [nodes]);

  const phaseSections = useMemo(() => {
    const knownGroupIds = new Set(groups.map((g) => g.id));
    const nodesByGroup = new Map<string, PlanNode[]>();
    const ungrouped: PlanNode[] = [];

    for (const node of nodes) {
      if (node.group_id && knownGroupIds.has(node.group_id)) {
        const list = nodesByGroup.get(node.group_id) ?? [];
        list.push(node);
        nodesByGroup.set(node.group_id, list);
      } else {
        ungrouped.push(node);
      }
    }

    const sections: Array<{ id: string; name: string; items: PlanNode[] }> =
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        items: nodesByGroup.get(g.id) ?? [],
      }));

    if (ungrouped.length > 0) {
      sections.push({ id: '__ungrouped__', name: 'Ungrouped', items: ungrouped });
    }

    return sections.map((section) => {
      const localIds = new Set(section.items.map((n) => n.id));
      const childrenByParent = new Map<string, PlanNode[]>();
      const roots: PlanNode[] = [];

      for (const item of section.items) {
        if (item.parent_id && localIds.has(item.parent_id)) {
          const list = childrenByParent.get(item.parent_id) ?? [];
          list.push(item);
          childrenByParent.set(item.parent_id, list);
        } else {
          roots.push(item);
        }
      }

      const doneCount = section.items.filter((n) => n.status === 'done').length;

      return {
        ...section,
        roots,
        childrenByParent,
        doneCount,
      };
    });
  }, [groups, nodes]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleNode = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const toggleStatusBucket = (status: NodeStatus) => {
    setCollapsedStatusBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedGroups(new Set());
    setCollapsedNodes(new Set());
  };

  const collapseAll = () => {
    setCollapsedGroups(new Set(phaseSections.map((s) => s.id)));
    setCollapsedNodes(new Set(nodes.map((n) => n.id)));
  };

  const buildBreadcrumb = (node: PlanNode): string => {
    const parts: string[] = [];
    if (node.group_id) {
      const grp = groupById.get(node.group_id);
      if (grp) {
        parts.push(grp.name);
      }
    }
    const chain: string[] = [];
    let currentParentId = node.parent_id;
    let guard = 0;
    while (currentParentId && guard < 16) {
      const parent = nodeById.get(currentParentId);
      if (!parent) {
        break;
      }
      chain.unshift(parent.title);
      currentParentId = parent.parent_id;
      guard += 1;
    }
    return [...parts, ...chain].join(' / ');
  };

  if (!project) {
    return (
      <section className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="max-w-sm rounded-lg border border-[#272B36] bg-[#181B22] p-6">
          <FolderGit2 className="mx-auto h-8 w-8 text-[#6384FF]" />
          <h2 className="mt-3 text-[15px] font-semibold text-[#E6E8EE]">
            Create your first project
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#8B92A5]">
            Add a project to generate its isolated MCP URL and view live plans synced from your coding agent.
          </p>
          <button
            type="button"
            onClick={onOpenAddProject}
            className="mt-4 inline-flex h-8 items-center rounded bg-[#6384FF] px-3.5 text-[13px] font-medium text-[#111318] transition-colors hover:bg-[#7A96FF]"
          >
            Add project
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[#272B36] bg-[#181B22]/60 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-[#E6E8EE]">
              {project.name}
            </h1>
            {project.summary ? (
              <p className="mt-0.5 line-clamp-1 text-[12px] text-[#8B92A5]">
                {project.summary}
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] text-[#6E768A]">
                {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} across{' '}
                {groups.length} {groups.length === 1 ? 'group' : 'groups'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'phase' && nodes.length > 0 && (
              <div className="flex items-center gap-1 text-[12px] text-[#8B92A5]">
                <button
                  type="button"
                  onClick={expandAll}
                  className="rounded px-2 py-1 transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="rounded px-2 py-1 transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                >
                  Collapse all
                </button>
              </div>
            )}

            <div
              role="group"
              aria-label="Tree grouping mode"
              className="inline-flex rounded border border-[#272B36] bg-[#111318] p-0.5 text-[12px]"
            >
              <button
                type="button"
                onClick={() => setViewMode('phase')}
                className={`rounded-sm px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'phase'
                    ? 'bg-[#1F242E] text-[#E6E8EE]'
                    : 'text-[#8B92A5] hover:text-[#E6E8EE]'
                }`}
              >
                By Phase
              </button>
              <button
                type="button"
                onClick={() => setViewMode('status')}
                className={`rounded-sm px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'status'
                    ? 'bg-[#1F242E] text-[#E6E8EE]'
                    : 'text-[#8B92A5] hover:text-[#E6E8EE]'
                }`}
              >
                By Status
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[12px] text-[#8B92A5]">
          {STATUS_BUCKETS.map((bucket) => (
            <span key={bucket.status} className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${STATUS_META[bucket.status].dot}`}
              />
              <span>{bucket.title}</span>
              <span className="font-mono text-[11px] text-[#E6E8EE]">
                {statusCounts[bucket.status]}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px] text-[#E06C75]">
            {error}
          </div>
        )}

        {loading && nodes.length === 0 ? (
          <div className="space-y-2.5">
            <div className="h-12 animate-pulse rounded border border-[#272B36] bg-[#181B22]" />
            <div className="h-24 animate-pulse rounded border border-[#272B36] bg-[#181B22]" />
          </div>
        ) : nodes.length === 0 && phaseSections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#272B36] bg-[#181B22] p-6 text-center">
            <Layers className="mx-auto h-7 w-7 text-[#6384FF]" />
            <h2 className="mt-3 text-[14px] font-semibold text-[#E6E8EE]">
              Waiting for a plan
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-[#8B92A5]">
              Connect Claude Code, OpenCode, or Antigravity using this project&apos;s MCP config and ask your agent to plan with{' '}
              <code className="font-mono text-[12px] text-[#E6E8EE]">upsert_plan</code>.
            </p>
            <button
              type="button"
              onClick={onOpenMcpConfig}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-3 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E]"
            >
              <Plug className="h-3.5 w-3.5 text-[#6384FF]" />
              <span>View MCP Config</span>
            </button>
          </div>
        ) : viewMode === 'phase' ? (
          <div className="space-y-3">
            {phaseSections.map((section) => {
              const isCollapsed = collapsedGroups.has(section.id);
              return (
                <div
                  key={section.id}
                  className="overflow-hidden rounded-lg border border-[#272B36] bg-[#181B22]"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-[#1F242E]/70">
                    <button
                      type="button"
                      onClick={() => toggleGroup(section.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#8B92A5]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[#8B92A5]" />
                      )}
                      <span className="truncate text-[13px] font-semibold text-[#E6E8EE]">
                        {section.name}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-[#8B92A5]">
                        {section.doneCount}/{section.items.length} done
                      </span>
                      {section.id !== '__ungrouped__' &&
                        (confirmDeleteGroupId === section.id ? (
                          <div className="flex items-center gap-1.5 rounded border border-[#E06C75]/40 bg-[#111318] px-2 py-0.5 text-[11px]">
                            <span className="text-[#8B92A5]">
                              Nodes stay ungrouped.
                            </span>
                            <button
                              type="button"
                              disabled={deletingGroupId === section.id}
                              onClick={() => setConfirmDeleteGroupId(null)}
                              className="text-[#8B92A5] hover:text-[#E6E8EE]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={deletingGroupId === section.id}
                              onClick={async () => {
                                setDeletingGroupId(section.id);
                                try {
                                  await onDeleteGroup(section.id);
                                  setConfirmDeleteGroupId(null);
                                } finally {
                                  setDeletingGroupId(null);
                                }
                              }}
                              className="font-medium text-[#E06C75] hover:underline disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete group ${section.name}`}
                            onClick={() => setConfirmDeleteGroupId(section.id)}
                            className="rounded p-1 text-[#6E768A] transition-colors hover:bg-[#272B36] hover:text-[#E06C75]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ))}
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="border-t border-[#272B36] px-2 py-2">
                      {section.roots.length === 0 ? (
                        <p className="px-2 py-1 text-[12px] text-[#6E768A]">
                          No nodes in this group yet.
                        </p>
                      ) : (
                        section.roots.map((root) => (
                          <TreeNodeItem
                            key={root.id}
                            node={root}
                            depth={0}
                            childrenByParent={section.childrenByParent}
                            collapsedIds={collapsedNodes}
                            selectedNodeId={selectedNodeId}
                            onToggleCollapse={toggleNode}
                            onSelectNode={onSelectNode}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {STATUS_BUCKETS.map((bucket) => {
              const items = nodes.filter((n) => n.status === bucket.status);
              const isCollapsed = collapsedStatusBuckets.has(bucket.status);
              const statusMeta = STATUS_META[bucket.status];

              return (
                <div
                  key={bucket.status}
                  className="overflow-hidden rounded-lg border border-[#272B36] bg-[#181B22]"
                >
                  <button
                    type="button"
                    onClick={() => toggleStatusBucket(bucket.status)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[#1F242E]/70"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-[#8B92A5]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[#8B92A5]" />
                      )}
                      <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} />
                      <span className="text-[13px] font-semibold text-[#E6E8EE]">
                        {bucket.title}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[#8B92A5]">
                      {items.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="border-t border-[#272B36] p-1.5">
                      {items.length === 0 ? (
                        <p className="px-2.5 py-1.5 text-[12px] text-[#6E768A]">
                          No {bucket.title.toLowerCase()} nodes.
                        </p>
                      ) : (
                        items.map((node) => {
                          const isSelected = selectedNodeId === node.id;
                          const typeMeta = TYPE_META[node.node_type];
                          const breadcrumb = buildBreadcrumb(node);
                          const checkedCount = node.checklist.filter(
                            (item) => item.checked
                          ).length;

                          return (
                            <button
                              key={node.id}
                              type="button"
                              onClick={() => onSelectNode(node.id)}
                              className={`flex w-full items-center justify-between gap-3 rounded-r border-l-2 px-2.5 py-2 text-left transition-colors ${
                                isSelected
                                  ? 'border-l-[#6384FF] bg-[#1F242E]'
                                  : 'border-l-transparent hover:bg-[#1F242E]/70'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium text-[#E6E8EE]">
                                  {node.title}
                                </div>
                                {breadcrumb && (
                                  <div className="mt-0.5 truncate text-[11px] text-[#8B92A5]">
                                    {breadcrumb}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {node.checklist.length > 0 && (
                                  <span className="font-mono text-[11px] text-[#8B92A5]">
                                    {checkedCount}/{node.checklist.length}
                                  </span>
                                )}
                                <span
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none ${typeMeta.className}`}
                                >
                                  {typeMeta.label}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
