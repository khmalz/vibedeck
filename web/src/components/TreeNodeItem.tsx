import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NodeStatus, NodeType, PlanNode } from '../types';

export const STATUS_META: Record<
  NodeStatus,
  { label: string; dot: string; badge: string }
> = {
  in_progress: {
    label: 'In Progress',
    dot: 'bg-[#6384FF]',
    badge: 'border-[#6384FF]/35 bg-[#6384FF]/12 text-[#8EA7FF]',
  },
  needs_review: {
    label: 'Needs Review',
    dot: 'bg-[#E5A93C]',
    badge: 'border-[#E5A93C]/35 bg-[#E5A93C]/12 text-[#F0BE63]',
  },
  done: {
    label: 'Done',
    dot: 'bg-[#3ECF8E]',
    badge: 'border-[#3ECF8E]/35 bg-[#3ECF8E]/12 text-[#64DFA8]',
  },
  planned: {
    label: 'Planned',
    dot: 'bg-[#6E768A]',
    badge: 'border-[#272B36] bg-[#111318] text-[#8B92A5]',
  },
};

export const TYPE_META: Record<NodeType, { label: string; className: string }> = {
  module: {
    label: 'module',
    className: 'border-[#272B36] bg-[#111318] text-[#8B92A5]',
  },
  task: {
    label: 'task',
    className: 'border-[#272B36] bg-[#111318] text-[#E6E8EE]/80',
  },
  revision: {
    label: 'revision',
    className: 'border-[#E06C75]/40 bg-[#E06C75]/12 text-[#E06C75]',
  },
};

interface TreeNodeItemProps {
  node: PlanNode;
  depth: number;
  childrenByParent: Map<string, PlanNode[]>;
  collapsedIds: Set<string>;
  selectedNodeId: string | null;
  onToggleCollapse: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

export function TreeNodeItem({
  node,
  depth,
  childrenByParent,
  collapsedIds,
  selectedNodeId,
  onToggleCollapse,
  onSelectNode,
}: TreeNodeItemProps) {
  const children = childrenByParent.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  const isSelected = selectedNodeId === node.id;

  const statusStyle = STATUS_META[node.status];
  const typeStyle = TYPE_META[node.node_type];
  const checkedCount = node.checklist.filter((item) => item.checked).length;

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectNode(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectNode(node.id);
          }
        }}
        className={`group relative flex cursor-pointer items-center justify-between gap-2 rounded-r border-l-2 py-1.5 pr-2.5 pl-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#6384FF] ${
          isSelected
            ? 'border-l-[#6384FF] bg-[#1F242E]'
            : 'border-l-transparent hover:bg-[#1F242E]/70'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hasChildren ? (
            <button
              type="button"
              aria-label={isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(node.id);
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#8B92A5] hover:bg-[#272B36] hover:text-[#E6E8EE]"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span aria-hidden="true" className="h-5 w-5 shrink-0" />
          )}

          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${statusStyle.dot}`}
          />

          <span className="truncate text-[13px] font-medium text-[#E6E8EE]">
            {node.title}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {node.checklist.length > 0 && (
            <span className="font-mono text-[11px] text-[#8B92A5]">
              {checkedCount}/{node.checklist.length}
            </span>
          )}
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none ${typeStyle.className}`}
          >
            {typeStyle.label}
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium ${statusStyle.badge}`}
          >
            {statusStyle.label}
          </span>
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="ml-4 border-l border-[#272B36] pl-2.5">
          {children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              collapsedIds={collapsedIds}
              selectedNodeId={selectedNodeId}
              onToggleCollapse={onToggleCollapse}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
