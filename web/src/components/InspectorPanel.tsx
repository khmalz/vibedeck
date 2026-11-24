import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Edit3,
  FileCode2,
  FileText,
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
import type { ChecklistItem, NodeStatus, PlanNode } from '../types';
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
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftScopeFiles, setDraftScopeFiles] = useState('');
  const [draftRules, setDraftRules] = useState('');

  const [newChecklistText, setNewChecklistText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
    setError(null);
    setNewChecklistText('');
    setDraftTitle(node?.title ?? '');
    setDraftDescription(node?.description ?? '');
    setDraftScopeFiles((node?.scope_files ?? []).join('\n'));
    setDraftRules(node?.rules ?? '');
    setFeedback(node?.human_feedback ?? '');
  }, [node?.id]);

  useEffect(() => {
    if (!node) {
      return;
    }
    setFeedback(node.human_feedback);
    if (!editing) {
      setDraftTitle(node.title);
      setDraftDescription(node.description);
      setDraftScopeFiles(node.scope_files.join('\n'));
      setDraftRules(node.rules);
    }
  }, [
    node?.title,
    node?.description,
    node?.scope_files,
    node?.rules,
    node?.human_feedback,
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

  const checkedCount = node.checklist.filter((item) => item.checked).length;

  const handleStatusChange = async (nextStatus: NodeStatus) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, { status: nextStatus });
      onNodeUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDetails = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle) {
      setError('Title cannot be empty.');
      return;
    }

    const parsedScopeFiles = draftScopeFiles
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        title: trimmedTitle,
        description: draftDescription,
        scope_files: parsedScopeFiles,
        rules: draftRules,
      });
      onNodeUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleChecklist = async (index: number) => {
    const nextChecklist: ChecklistItem[] = node.checklist.map((item, idx) =>
      idx === index ? { ...item, checked: !item.checked } : item
    );
    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        checklist: nextChecklist,
      });
      onNodeUpdated(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update checklist.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAddChecklistItem = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newChecklistText.trim();
    if (!trimmed) {
      return;
    }
    const nextChecklist: ChecklistItem[] = [
      ...node.checklist,
      { text: trimmed, checked: false },
    ];
    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        checklist: nextChecklist,
      });
      onNodeUpdated(updated);
      setNewChecklistText('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to add checklist item.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveChecklistItem = async (index: number) => {
    const nextChecklist = node.checklist.filter((_, idx) => idx !== index);
    setBusy(true);
    setError(null);
    try {
      const updated = await patchNode(projectId, node.id, {
        checklist: nextChecklist,
      });
      onNodeUpdated(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to remove checklist item.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await approveNode(projectId, node.id);
      onNodeUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve node.');
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
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
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

          <select
            aria-label="Node status"
            disabled={busy}
            value={node.status}
            onChange={(e) => handleStatusChange(e.target.value as NodeStatus)}
            className="h-8 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#E6E8EE] focus:border-[#6384FF] focus:outline-none disabled:opacity-50"
          >
            {(Object.keys(STATUS_META) as NodeStatus[]).map((statusKey) => (
              <option key={statusKey} value={statusKey}>
                {STATUS_META[statusKey].label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="mt-3 rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px] text-[#E06C75]">
            {error}
          </p>
        )}

        {editing ? (
          <form onSubmit={handleSaveDetails} className="mt-4 space-y-3 border-t border-[#272B36] pt-4">
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
                htmlFor="node-description-input"
                className="mb-1 block text-[12px] font-medium text-[#8B92A5]"
              >
                Description (Markdown)
              </label>
              <textarea
                id="node-description-input"
                rows={4}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] focus:border-[#6384FF] focus:outline-none"
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
                onClick={() => {
                  setEditing(false);
                  setDraftTitle(node.title);
                  setDraftDescription(node.description);
                  setDraftScopeFiles(node.scope_files.join('\n'));
                  setDraftRules(node.rules);
                }}
                className="h-8 rounded border border-[#272B36] px-3 text-[12px] font-medium text-[#8B92A5] hover:bg-[#1F242E] hover:text-[#E6E8EE]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-[#6384FF] px-3 text-[12px] font-medium text-[#111318] hover:bg-[#7A96FF] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save changes</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4 border-t border-[#272B36] pt-4">
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium text-[#8B92A5]">
                Description
              </h3>
              {node.description.trim() ? (
                <MarkdownView content={node.description} />
              ) : (
                <p className="text-[13px] text-[#6E768A]">
                  No description provided yet.
                </p>
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
            {checkedCount}/{node.checklist.length}
          </span>
        </div>

        {node.checklist.length === 0 ? (
          <p className="mb-2.5 text-[12px] text-[#6E768A]">
            No checklist items yet.
          </p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {node.checklist.map((item, idx) => (
              <li
                key={`${idx}-${item.text}`}
                className="group flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-[#1F242E]/70"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={item.checked}
                    onChange={() => handleToggleChecklist(idx)}
                    className="h-3.5 w-3.5 rounded border-[#272B36] bg-[#111318] accent-[#3ECF8E]"
                  />
                  <span
                    className={`truncate text-[13px] ${
                      item.checked
                        ? 'text-[#6E768A] line-through'
                        : 'text-[#E6E8EE]'
                    }`}
                  >
                    {item.text}
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${item.text}`}
                  onClick={() => handleRemoveChecklistItem(idx)}
                  className="rounded p-0.5 text-[#6E768A] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#E06C75] focus:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddChecklistItem} className="flex items-center gap-2">
          <input
            type="text"
            value={newChecklistText}
            onChange={(e) => setNewChecklistText(e.target.value)}
            placeholder="Add checklist item"
            className="h-8 min-w-0 flex-1 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !newChecklistText.trim()}
            className="inline-flex h-8 items-center gap-1 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        </form>
      </div>

      <div
        className={`rounded-lg border bg-[#181B22] p-4 ${
          node.status === 'needs_review'
            ? 'border-[#E5A93C]/45'
            : 'border-[#272B36]'
        }`}
      >
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#E6E8EE]">
          <Sparkles
            className={`h-3.5 w-3.5 ${
              node.status === 'needs_review'
                ? 'text-[#E5A93C]'
                : 'text-[#6384FF]'
            }`}
          />
          <span>AI Report</span>
        </h3>
        {node.ai_report.trim() ? (
          <MarkdownView content={node.ai_report} />
        ) : (
          <p className="text-[12px] text-[#6E768A]">
            No AI completion report submitted yet.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[#272B36] bg-[#181B22] p-4">
        <label
          htmlFor="human-feedback-input"
          className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#E6E8EE]"
        >
          <MessageSquareWarning className="h-3.5 w-3.5 text-[#E5A93C]" />
          <span>Human Review &amp; Feedback</span>
        </label>
        <textarea
          id="human-feedback-input"
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Notes or revision instructions passed back to the AI agent on next start_node / get_node_context"
          className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
        </div>
      </div>
    </div>
  );
}
