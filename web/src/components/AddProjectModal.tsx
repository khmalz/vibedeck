import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { createProject } from '../api/client';
import type { Project } from '../types';

interface AddProjectModalProps {
  open: boolean;
  initialProject: Project | null;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

type ConfigTabKey = 'claude' | 'opencode' | 'antigravity';

function getMcpBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3333';
  }
  if (window.location.port === '5173') {
    return 'http://localhost:3333';
  }
  return window.location.origin;
}

function buildConfigTemplates(mcpUrl: string) {
  return {
    claude: {
      label: 'Claude Code',
      filename: '.mcp.json',
      content: JSON.stringify(
        {
          mcpServers: {
            vibedeck: {
              type: 'http',
              url: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    },
    opencode: {
      label: 'OpenCode',
      filename: 'opencode.json',
      content: JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            vibedeck: {
              type: 'remote',
              url: mcpUrl,
              enabled: true,
            },
          },
        },
        null,
        2
      ),
    },
    antigravity: {
      label: 'Antigravity / Generic',
      filename: 'mcp_config.json',
      content: JSON.stringify(
        {
          mcpServers: {
            vibedeck: {
              serverUrl: mcpUrl,
            },
          },
        },
        null,
        2
      ),
    },
  } satisfies Record<
    ConfigTabKey,
    { label: string; filename: string; content: string }
  >;
}

export function AddProjectModal({
  open,
  initialProject,
  onClose,
  onCreated,
}: AddProjectModalProps) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(
    initialProject
  );
  const [activeTab, setActiveTab] = useState<ConfigTabKey>('claude');
  const [copiedField, setCopiedField] = useState<'url' | 'config' | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveProject(initialProject);
    setName('');
    setSummary('');
    setError(null);
    setSubmitting(false);
    setCopiedField(null);
    setActiveTab('claude');
  }, [open, initialProject]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const mcpUrl = useMemo(() => {
    if (!activeProject) {
      return '';
    }
    return `${getMcpBaseUrl()}/mcp/${activeProject.id}`;
  }, [activeProject]);

  const templates = useMemo(() => buildConfigTemplates(mcpUrl), [mcpUrl]);

  if (!open) {
    return null;
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Project name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await createProject({
        name: trimmedName,
        summary: summary.trim(),
      });
      setActiveProject(created);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (text: string, field: 'url' | 'config') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1600);
    } catch {
      setError('Clipboard write failed. Copy the text manually.');
    }
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([`${content}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const currentTemplate = templates[activeTab];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activeProject ? 'MCP Configuration' : 'Add Project'}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-xl rounded-lg border border-[#272B36] bg-[#181B22] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#272B36] px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-[#E6E8EE]">
              {activeProject
                ? `Connect AI Agent — ${activeProject.name}`
                : 'New VibeDeck Project'}
            </h2>
            <p className="mt-0.5 text-[12px] text-[#8B92A5]">
              {activeProject
                ? 'Each project gets an isolated MCP endpoint scoped to its UUID.'
                : 'Create an isolated workspace and generate its MCP config.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="rounded p-1 text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!activeProject ? (
          <form onSubmit={handleCreate} className="space-y-4 p-5">
            <div>
              <label
                htmlFor="project-name"
                className="mb-1.5 block text-[13px] font-medium text-[#E6E8EE]"
              >
                Project name
              </label>
              <input
                id="project-name"
                type="text"
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Payments Service"
                className="w-full rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="project-summary"
                className="mb-1.5 block text-[13px] font-medium text-[#E6E8EE]"
              >
                Summary <span className="text-[#8B92A5]">(optional)</span>
              </label>
              <textarea
                id="project-summary"
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Short architecture context shown to connected agents"
                className="w-full resize-none rounded border border-[#272B36] bg-[#111318] px-3 py-2 text-[13px] text-[#E6E8EE] placeholder-[#6E768A] focus:border-[#6384FF] focus:outline-none"
              />
            </div>

            {error && (
              <p className="rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px] text-[#E06C75]">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded border border-[#272B36] px-3 text-[13px] font-medium text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-8 rounded bg-[#6384FF] px-3.5 text-[13px] font-medium text-[#111318] transition-colors hover:bg-[#7A96FF] disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 p-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-[#8B92A5]">
                <span>Project MCP Endpoint</span>
                <span className="font-mono text-[11px] text-[#6E768A]">
                  {activeProject.id}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded border border-[#272B36] bg-[#111318] px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#E6E8EE]">
                  {mcpUrl}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(mcpUrl, 'url')}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-[#272B36] bg-[#181B22] px-2 py-1 text-[11px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E]"
                >
                  {copiedField === 'url' ? (
                    <>
                      <Check className="h-3 w-3 text-[#3ECF8E]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-[#8B92A5]" />
                      <span>Copy URL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 border-b border-[#272B36]">
                {(Object.keys(templates) as ConfigTabKey[]).map((key) => {
                  const tab = templates[key];
                  const selected = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveTab(key)}
                      className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-medium transition-colors ${
                        selected
                          ? 'border-[#6384FF] text-[#E6E8EE]'
                          : 'border-transparent text-[#8B92A5] hover:text-[#E6E8EE]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 rounded border border-[#272B36] bg-[#111318]">
                <div className="flex items-center justify-between border-b border-[#272B36] px-3 py-2">
                  <span className="font-mono text-[11px] text-[#8B92A5]">
                    {currentTemplate.filename}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(currentTemplate.content, 'config')
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#272B36] bg-[#181B22] px-2 py-1 text-[11px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E]"
                    >
                      {copiedField === 'config' ? (
                        <>
                          <Check className="h-3 w-3 text-[#3ECF8E]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-[#8B92A5]" />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownload(
                          currentTemplate.filename,
                          currentTemplate.content
                        )
                      }
                      className="inline-flex items-center gap-1 rounded bg-[#6384FF] px-2.5 py-1 text-[11px] font-medium text-[#111318] transition-colors hover:bg-[#7A96FF]"
                    >
                      <Download className="h-3 w-3" />
                      <span>Download {currentTemplate.filename}</span>
                    </button>
                  </div>
                </div>
                <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-[#E6E8EE]">
                  {currentTemplate.content}
                </pre>
              </div>
            </div>

            {error && (
              <p className="rounded border border-[#E06C75]/40 bg-[#E06C75]/10 px-3 py-2 text-[12px] text-[#E06C75]">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded border border-[#272B36] bg-[#1F242E] px-3.5 text-[13px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#272B36]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
