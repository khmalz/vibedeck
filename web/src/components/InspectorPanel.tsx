import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Edit3,
  FileCode2,
  FileText,
  GitBranch,
  MessageSquareWarning,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  approveNode,
  deleteNode,
  patchNode,
  requestNodeRevision,
} from '../api/client';
import type {
  ChecklistItem,
  NodeStatus,
  PlanNode,
  ReviewHistoryEntry,
  ReviewHistoryType,
} from '../types';
import { STATUS_META, TYPE_META } from './TreeNodeItem';

interface InspectorPanelProps {
  projectId: string | null;
  node: PlanNode | null;
  ancestors: PlanNode[];
  groupName: string | null;
  onSelectNode: (nodeId: string) => void;
  onNodeUpdated: (node: PlanNode) => void;
  onNodeDeleted: (nodeId: string) => void;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={key++}
          className="rounded border border-[#272B36] bg-[#111318] px-1 py-0.5 font-mono text-[12px] text-[#E6E8EE]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={key++} className="font-semibold text-[#E6E8EE]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={key++} className="italic text-[#E6E8EE]/90">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

function MarkdownView({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded border border-[#272B36] bg-[#111318] p-2.5 font-mono text-[12px] leading-relaxed text-[#E6E8EE]"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const body = headingMatch[2]!;
      const cls =
        level === 1
          ? 'text-[14px] font-semibold text-[#E6E8EE]'
          : level === 2
            ? 'text-[13px] font-semibold text-[#E6E8EE]'
            : 'text-[12px] font-semibold text-[#E6E8EE]/90';
      blocks.push(
        <div key={key++} className={cls}>
          {renderInlineMarkdown(body)}
        </div>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-[#6384FF]/60 pl-3 text-[13px] text-[#8B92A5]"
        >
          {renderInlineMarkdown(quoteLines.join(' '))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-[13px] text-[#E6E8EE]/90">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5 text-[13px] text-[#E6E8EE]/90">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trim().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith('>') &&
      !/^[-*]\s+/.test(lines[i]!.trim()) &&
      !/^\d+\.\s+/.test(lines[i]!.trim())
    ) {
      paraLines.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="text-[13px] leading-relaxed text-[#E6E8EE]/90">
        {renderInlineMarkdown(paraLines.join(' '))}
      </p>
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}

export function InspectorPanel({
  projectId,
  node,
  ancestors,
  groupName,
  onSelectNode,
  onNodeUpdated,
  onNodeDeleted,
}: InspectorPanelProps) {
  const [editing, setEditing] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftStatus, setDraftStatus] = useState<NodeStatus>('planned');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftScopeFiles, setDraftScopeFiles] = useState('');
  const [draftRules, setDraftRules] = useState('');
  const [draftChecklist, setDraftChecklist] = useState<ChecklistItem[]>([]);

  const [newChecklistText, setNewChecklistText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editingFeedback, setEditingFeedback] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setPlanExpanded(false);
    setEditingFeedback(false);
    setShowAllHistory(false);
    setConfirmingDelete(false);
    setError(null);
    setNewChecklistText('');
    setDraftTitle(node?.title ?? '');
    setDraftStatus(node?.status ?? 'planned');
    setDraftDescription(node?.description ?? '');
    setDraftScopeFiles((node?.scope_files ?? []).join('\n'));
    setDraftRules(node?.rules ?? '');
    setDraftChecklist(node?.checklist.map((item) => ({ ...item })) ?? []);
    setFeedback(node?.human_feedback ?? '');
  }, [node?.id]);

  const scopeFilesKey = node?.scope_files.join('\n') ?? '';
  const checklistKey = JSON.stringify(node?.checklist ?? []);

  useEffect(() => {
    setFeedback(node?.human_feedback ?? '');
  }, [node?.id, node?.human_feedback]);

  useEffect(() => {
    if (!node || editing) {
      return;
    }
    setDraftTitle(node.title);
    setDraftStatus(node.status);
    setDraftDescription(node.description);
    setDraftScopeFiles(scopeFilesKey);
    setDraftRules(node.rules);
    setDraftChecklist(node.checklist.map((item) => ({ ...item })));
  }, [
    node?.id,
    node?.title,
    node?.status,
    node?.description,
    scopeFilesKey,
    node?.rules,
    checklistKey,
    editing,
  ]);

  if (!projectId || !node) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-[#272B36] bg-[#181B22]/40 p-6 text-center">
        <div>
          <FileText className="mx-auto h-6 w-6 text-[#6E768A]" />
          <p className="mt-2.5 text-[13px] font-medium text-[#E6E8EE]">
            Select a node to inspect
          </p>
          <p className="mt-1 text-[12px] text-[#8B92A5]">
            Review details, scope files, rules, checklist items, and AI reports here.
          </p>
        </div>
      </div>
    );
  }

  const displayedChecklist = editing ? draftChecklist : node.checklist;
  const checkedCount = displayedChecklist.filter((item) => item.checked).length;

  const handleStartEdit = () => {
    setDraftTitle(node.title);
    setDraftStatus(node.status);
    setDraftDescription(node.description);
    setDraftScopeFiles(node.scope_files.join('\n'));
    setDraftRules(node.rules);
    setDraftChecklist(node.checklist.map((item) => ({ ...item })));
    setNewChecklistText('');
    setError(null);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftTitle(node.title);
    setDraftStatus(node.status);
    setDraftDescription(node.description);
    setDraftScopeFiles(node.scope_files.join('\n'));
    setDraftRules(node.rules);
    setDraftChecklist(node.checklist.map((item) => ({ ...item })));
    setNewChecklistText('');
    setError(null);
    setEditing(false);
  };

  const handleToggleDraftChecklist = (index: number) => {
    setDraftChecklist((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const handleEditDraftChecklistText = (index: number, text: string) => {
    setDraftChecklist((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, text } : item))
    );
  };

  const handleRemoveDraftChecklist = (index: number) => {
    setDraftChecklist((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAddDraftChecklist = () => {
    const trimmed = newChecklistText.trim();
    if (!trimmed) {
      return;
    }
    setDraftChecklist((prev) => [...prev, { text: trimmed, checked: false }]);
    setNewChecklistText('');
  };

  const handleSaveDetails = async () => {
    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle) {
      setError('Title cannot be empty.');
      return;
    }

    const parsedScopeFiles = draftScopeFiles
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const pendingItem = newChecklistText.trim();
    const finalChecklist: ChecklistItem[] = [
      ...draftChecklist
        .map((item) => ({ ...item, text: item.text.trim() }))
        .filter((item) => item.text.length > 0),
      ...(pendingItem ? [{ text: pendingItem, checked: false }] : []),
    ];

    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        title: trimmedTitle,
        status: draftStatus,
        description: draftDescription,
        scope_files: parsedScopeFiles,
        rules: draftRules,
        checklist: finalChecklist,
      });
      onNodeUpdated(updated);
      setNewChecklistText('');
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await approveNode(projectId, node.id, feedback.trim() || undefined);
      onNodeUpdated(updated);
      setFeedback('');
      setEditingFeedback(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve node.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNote = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        human_feedback: feedback.trim(),
      });
      onNodeUpdated(updated);
      setEditingFeedback(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save feedback.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestRevision = async () => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      setError('Enter human feedback before requesting a revision.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await requestNodeRevision(projectId, node.id, trimmed);
      onNodeUpdated(updated);
      setFeedback('');
      setEditingFeedback(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to request revision.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNode = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteNode(projectId, node.id);
      onNodeDeleted(node.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete node.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#272B36] bg-[#181B22] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav
            aria-label="Ancestor breadcrumb"
            className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-[#8B92A5]"
          >
            {groupName && (
              <>
                <span className="rounded border border-[#272B36] bg-[#111318] px-1.5 py-0.5 text-[11px] text-[#8B92A5]">
                  {groupName}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6E768A]" />
              </>
            )}
            {ancestors.map((ancestor) => (
              <span key={ancestor.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectNode(ancestor.id)}
                  className="max-w-[140px] truncate rounded px-1 py-0.5 text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                >
                  {ancestor.title}
                </button>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6E768A]" />
              </span>
            ))}
            <span className="truncate font-medium text-[#E6E8EE]">
              {node.title}
            </span>
          </nav>

          <div className="flex items-center gap-1.5">
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCancelEdit}
                  className="inline-flex h-7 items-center rounded border border-[#272B36] px-2.5 text-[12px] font-medium text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveDetails}
                  className="inline-flex h-7 items-center gap-1 rounded bg-[#6384FF] px-2.5 text-[12px] font-medium text-[#111318] transition-colors hover:bg-[#7A96FF] disabled:opacity-50"
                >
                  <Save className="h-3 w-3" />
                  <span>Save changes</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartEdit}
                className="inline-flex h-7 items-center gap-1 rounded border border-[#272B36] bg-[#111318] px-2 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E]"
              >
                <Edit3 className="h-3 w-3 text-[#8B92A5]" />
                <span>Edit</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Delete node"
              onClick={() => setConfirmingDelete((prev) => !prev)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#272B36] bg-[#111318] text-[#8B92A5] transition-colors hover:border-[#E06C75]/50 hover:bg-[#E06C75]/10 hover:text-[#E06C75]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {confirmingDelete && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px]">
            <span className="text-[#E6E8EE]">
              Delete this node and any child nodes?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                className="rounded border border-[#272B36] bg-[#181B22] px-2 py-1 text-[11px] font-medium text-[#8B92A5] hover:text-[#E6E8EE]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDeleteNode}
                className="rounded bg-[#E06C75] px-2.5 py-1 text-[11px] font-medium text-[#111318] hover:bg-[#E7838B] disabled:opacity-50"
              >
                Confirm delete
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-[#E6E8EE]">
              {node.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none ${
                  TYPE_META[node.node_type].className
                }`}
              >
                {TYPE_META[node.node_type].label}
              </span>
              <span className="font-mono text-[11px] text-[#6E768A]">
                id:{node.id}
              </span>
            </div>
          </div>

          {!editing && (
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[12px] font-medium ${STATUS_META[node.status].badge}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${STATUS_META[node.status].dot}`}
              />
              <span>{STATUS_META[node.status].label}</span>
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px] text-[#E06C75]">
            {error}
          </p>
        )}

        {editing ? (
          <div className="mt-4 space-y-3 border-t border-[#272B36] pt-4">
            {node.status === 'in_progress' && (
              <p className="rounded border border-[#E5A93C]/35 bg-[#E5A93C]/10 px-3 py-2 text-[12px] text-[#F0BE63]">
                This node is in progress — saved edits take effect on the agent&apos;s next read.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_168px]">
              <div>
                <label
                  htmlFor="node-title-input"
                  className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
                >
                  Title
                </label>
                <input
                  id="node-title-input"
                  type="text"
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-1.5 text-[13px] text-[#E6E8EE] focus:border-[#6384FF] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="node-status-select"
                  className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
                >
                  Status
                </label>
                <select
                  id="node-status-select"
                  aria-label="Node status"
                  disabled={busy}
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as NodeStatus)}
                  className="h-[34px] w-full rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#E6E8EE] focus:border-[#6384FF] focus:outline-none disabled:opacity-50"
                >
                  {(Object.keys(STATUS_META) as NodeStatus[]).map((statusKey) => (
                    <option key={statusKey} value={statusKey}>
                      {STATUS_META[statusKey].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="node-description-input"
                className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
              >
                Plan &amp; Process (Markdown)
              </label>
              <textarea
                id="node-description-input"
                rows={4}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="Goal, step-by-step approach, and implementation notes"
                className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="node-scope-input"
                className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
              >
                Scope files (one path per line)
              </label>
              <textarea
                id="node-scope-input"
                rows={3}
                value={draftScopeFiles}
                onChange={(e) => setDraftScopeFiles(e.target.value)}
                placeholder="src/routes/auth.ts"
                className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 font-mono text-[12px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="node-rules-input"
                className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
              >
                Rules
              </label>
              <textarea
                id="node-rules-input"
                rows={2}
                value={draftRules}
                onChange={(e) => setDraftRules(e.target.value)}
                placeholder="Constraints AI agents must obey for this node"
                className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelEdit}
                className="h-8 rounded border border-[#272B36] px-3 text-[12px] font-medium text-[#8B92A5] hover:bg-[#1F242E] hover:text-[#E6E8EE]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveDetails}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-[#6384FF] px-3 text-[12px] font-medium text-[#111318] hover:bg-[#7A96FF] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save changes</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4 border-t border-[#272B36] pt-4">
            <div className="rounded border border-[#272B36] bg-[#111318]">
              <button
                type="button"
                aria-expanded={planExpanded}
                onClick={() => setPlanExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[#1F242E]/70"
              >
                <span className="flex items-center gap-1.5">
                  {planExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-[#8B92A5]" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-[#8B92A5]" />
                  )}
                  <span className="text-[12px] font-medium text-[#E6E8EE]">
                    Plan &amp; Process
                  </span>
                </span>
                <span className="text-[11px] text-[#6E768A]">
                  {!node.description.trim()
                    ? 'Empty'
                    : planExpanded
                      ? 'Hide'
                      : 'Review'}
                </span>
              </button>
              {planExpanded && (
                <div className="border-t border-[#272B36] px-3 py-3">
                  {node.description.trim() ? (
                    <MarkdownView content={node.description} />
                  ) : (
                    <p className="text-[12px] text-[#6E768A]">
                      No plan or process details written yet.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[#8B92A5]">
                <FileCode2 className="h-3.5 w-3.5" />
                <span>Scope Files</span>
              </h3>
              {node.scope_files.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {node.scope_files.map((file) => (
                    <code
                      key={file}
                      className="rounded border border-[#272B36] bg-[#111318] px-2 py-0.5 font-mono text-[12px] text-[#E6E8EE]"
                    >
                      {file}
                    </code>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[#6E768A]">None specified.</p>
              )}
            </div>

            {node.rules.trim() && (
              <div className="rounded border border-[#272B36] bg-[#111318] p-3">
                <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[#8B92A5]">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#E5A93C]" />
                  <span>Rules</span>
                </h3>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#E6E8EE]/90">
                  {node.rules}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#272B36] bg-[#181B22] p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#E6E8EE]">
            Checklist
          </h3>
          <span className="font-mono text-[11px] text-[#8B92A5]">
            {checkedCount}/{displayedChecklist.length}
          </span>
        </div>

        {editing ? (
          <>
            {draftChecklist.length === 0 ? (
              <p className="mb-2.5 text-[12px] text-[#6E768A]">
                No checklist items yet.
              </p>
            ) : (
              <ul className="mb-3 space-y-1.5">
                {draftChecklist.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[#1F242E]/70"
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={item.checked}
                      onChange={() => handleToggleDraftChecklist(idx)}
                      aria-label={`Toggle ${item.text || `item ${idx + 1}`}`}
                      className="h-3.5 w-3.5 shrink-0 rounded border-[#272B36] bg-[#111318] accent-[#3ECF8E]"
                    />
                    <input
                      type="text"
                      disabled={busy}
                      value={item.text}
                      onChange={(e) =>
                        handleEditDraftChecklistText(idx, e.target.value)
                      }
                      aria-label={`Checklist item ${idx + 1}`}
                      className="h-7 min-w-0 flex-1 rounded border border-[#272B36] bg-[#111318] px-2 text-[13px] text-[#E6E8EE] focus:border-[#6384FF] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${item.text || `item ${idx + 1}`}`}
                      onClick={() => handleRemoveDraftChecklist(idx)}
                      className="rounded p-1 text-[#8B92A5] transition-colors hover:text-[#E06C75]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                disabled={busy}
                value={newChecklistText}
                onChange={(e) => setNewChecklistText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftChecklist();
                  }
                }}
                placeholder="Add checklist item"
                className="h-8 min-w-0 flex-1 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !newChecklistText.trim()}
                onClick={handleAddDraftChecklist}
                className="inline-flex h-8 items-center gap-1 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="mt-3 flex justify-end gap-2 border-t border-[#272B36] pt-3">
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelEdit}
                className="h-8 rounded border border-[#272B36] px-3 text-[12px] font-medium text-[#8B92A5] hover:bg-[#1F242E] hover:text-[#E6E8EE]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveDetails}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-[#6384FF] px-3 text-[12px] font-medium text-[#111318] hover:bg-[#7A96FF] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save changes</span>
              </button>
            </div>
          </>
        ) : node.checklist.length === 0 ? (
          <p className="text-[12px] text-[#6E768A]">
            No checklist items yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {node.checklist.map((item, idx) => (
              <li
                key={`${idx}-${item.text}`}
                className="flex items-start gap-2.5 px-1 py-0.5"
              >
                {item.checked ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3ECF8E]" />
                ) : (
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6E768A]" />
                )}
                <span
                  className={`text-[13px] ${
                    item.checked
                      ? 'text-[#6E768A] line-through'
                      : 'text-[#E6E8EE]'
                  }`}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(() => {
        const timelineEntries: ReviewHistoryEntry[] =
          node.review_history.length > 0
            ? node.review_history
            : node.ai_report.trim()
              ? [
                  {
                    id: 'legacy-ai-report',
                    type: 'ai_report',
                    content: node.ai_report.trim(),
                    created_at: node.updated_at,
                  },
                ]
              : [];

        const hiddenCount =
          !showAllHistory && timelineEntries.length > 4
            ? timelineEntries.length - 4
            : 0;
        const visibleEntries =
          hiddenCount > 0 ? timelineEntries.slice(hiddenCount) : timelineEntries;

        const entryMeta: Record<
          ReviewHistoryType,
          { label: string; dot: string; badge: string }
        > = {
          human_feedback: {
            label: 'You · Feedback',
            dot: 'bg-[#E5A93C]',
            badge: 'border-[#E5A93C]/35 bg-[#E5A93C]/12 text-[#F0BE63]',
          },
          ai_plan: {
            label: 'AI · Revision Plan',
            dot: 'bg-[#6384FF]',
            badge: 'border-[#6384FF]/35 bg-[#6384FF]/12 text-[#8EA7FF]',
          },
          ai_report: {
            label: 'AI · Completion Report',
            dot: 'bg-[#6384FF]',
            badge: 'border-[#272B36] bg-[#111318] text-[#E6E8EE]',
          },
          approved: {
            label: 'You · Approved',
            dot: 'bg-[#3ECF8E]',
            badge: 'border-[#3ECF8E]/35 bg-[#3ECF8E]/12 text-[#64DFA8]',
          },
        };

        return (
          <div
            className={`rounded-lg border bg-[#181B22] p-4 ${
              node.status === 'needs_review'
                ? 'border-[#E5A93C]/45'
                : 'border-[#272B36]'
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#E6E8EE]">
                <Clock
                  className={`h-3.5 w-3.5 ${
                    node.status === 'needs_review'
                      ? 'text-[#E5A93C]'
                      : 'text-[#6384FF]'
                  }`}
                />
                <span>Review &amp; Revision Timeline</span>
              </h3>
              <span className="font-mono text-[11px] text-[#8B92A5]">
                {timelineEntries.length}{' '}
                {timelineEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {timelineEntries.length === 0 ? (
              <p className="text-[12px] text-[#6E768A]">
                No AI completion report or review activity yet.
              </p>
            ) : (
              <div className="space-y-3">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllHistory(true)}
                    className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-1.5 text-[12px] font-medium text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                  >
                    Show {hiddenCount} earlier{' '}
                    {hiddenCount === 1 ? 'entry' : 'entries'}
                  </button>
                )}

                <div className="relative ml-2 space-y-3 border-l border-[#272B36] pl-4">
                  {visibleEntries.map((entry, idx) => {
                    const isLatestReport =
                      idx === visibleEntries.length - 1 &&
                      entry.type === 'ai_report' &&
                      node.status === 'needs_review';
                    const meta = entryMeta[entry.type];
                    const timeLabel = new Date(entry.created_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={entry.id}
                        className={`relative rounded border bg-[#111318] p-3 ${
                          isLatestReport
                            ? 'border-[#E5A93C]/45'
                            : 'border-[#272B36]'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute -left-[21px] top-3.5 h-2.5 w-2.5 rounded-full border-2 border-[#181B22] ${
                            isLatestReport ? 'bg-[#E5A93C]' : meta.dot
                          }`}
                        />
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {entry.type === 'ai_report' && (
                              <Sparkles
                                className={`h-3 w-3 ${
                                  isLatestReport ? 'text-[#E5A93C]' : 'text-[#6384FF]'
                                }`}
                              />
                            )}
                            {entry.type === 'ai_plan' && (
                              <GitBranch className="h-3 w-3 text-[#6384FF]" />
                            )}
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                                isLatestReport
                                  ? 'border-[#E5A93C]/45 bg-[#E5A93C]/12 text-[#F0BE63]'
                                  : meta.badge
                              }`}
                            >
                              {meta.label}
                            </span>
                            {isLatestReport && (
                              <span className="rounded bg-[#E5A93C]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#F0BE63]">
                                Latest
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-[#6E768A]">
                            {timeLabel}
                          </span>
                        </div>
                        <MarkdownView content={entry.content} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="rounded-lg border border-[#272B36] bg-[#181B22] p-4">
        {node.status === 'done' ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#E6E8EE]">
              <CheckCircle2 className="h-4 w-4 text-[#3ECF8E]" />
              <span>Approved</span>
            </div>
            <span className="rounded border border-[#3ECF8E]/35 bg-[#3ECF8E]/12 px-2 py-0.5 text-[11px] font-medium text-[#64DFA8]">
              Approved — node marked done.
            </span>
          </div>
        ) : node.status === 'in_progress' &&
          node.human_feedback.trim() &&
          !editingFeedback ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#F0BE63]">
                <RotateCcw className="h-3.5 w-3.5 text-[#E5A93C]" />
                <span>Revision requested — awaiting AI revision plan &amp; resubmission</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingFeedback(true)}
                className="inline-flex h-7 items-center gap-1 rounded border border-[#272B36] bg-[#111318] px-2 text-[11px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E]"
              >
                <Edit3 className="h-3 w-3 text-[#8B92A5]" />
                <span>Edit feedback</span>
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded border border-[#E5A93C]/35 bg-[#E5A93C]/10 px-3 py-2 text-[13px] leading-relaxed text-[#E6E8EE]">
              {node.human_feedback}
            </p>
          </div>
        ) : (
          <>
            <label
              htmlFor="human-feedback-input"
              className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#E6E8EE]"
            >
              <MessageSquareWarning className="h-3.5 w-3.5 text-[#E5A93C]" />
              <span>
                {node.status === 'planned'
                  ? 'Plan & Process Feedback'
                  : 'Human Review & Feedback'}
              </span>
            </label>
            <textarea
              id="human-feedback-input"
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={
                node.status === 'planned'
                  ? 'Feedback or adjustments on the planned approach before the AI calls start_node'
                  : 'Notes or revision instructions passed back to the AI agent on next start_node / get_node_context'
              }
              className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
            />

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {node.status === 'needs_review' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRequestRevision}
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-[#E5A93C]/45 bg-[#E5A93C]/12 px-3 text-[12px] font-medium text-[#F0BE63] transition-colors hover:bg-[#E5A93C]/20 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Request Revision</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleApprove}
                    className="inline-flex h-8 items-center gap-1.5 rounded bg-[#3ECF8E] px-3.5 text-[12px] font-semibold text-[#111318] transition-colors hover:bg-[#53D99E] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Approve (Done)</span>
                  </button>
                </>
              ) : (
                <>
                  {node.status === 'in_progress' && editingFeedback && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setFeedback(node.human_feedback);
                        setEditingFeedback(false);
                      }}
                      className="h-8 rounded border border-[#272B36] px-3 text-[12px] font-medium text-[#8B92A5] hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveNote}
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-3 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E] disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5 text-[#6384FF]" />
                    <span>Save feedback</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
