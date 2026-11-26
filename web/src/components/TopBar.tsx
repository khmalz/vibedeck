import { useRef } from 'react';
import { ChevronDown, Download, Plug, Plus, Trash2, Upload } from 'lucide-react';
import type { Project, SseConnectionState } from '../types';

interface TopBarProps {
  projects: Project[];
  activeProjectId: string | null;
  sseState: SseConnectionState;
  exporting?: boolean;
  importing?: boolean;
  onSelectProject: (projectId: string) => void;
  onOpenAddProject: () => void;
  onOpenMcpConfig: () => void;
  onExportProject: () => void;
  onImportProjectFile: (file: File) => void;
  onOpenDeleteProject: () => void;
}

const SSE_BADGE: Record<
  SseConnectionState,
  { dot: string; label: string; text: string }
> = {
  idle: { dot: 'bg-[#6E768A]', label: 'Offline', text: 'text-[#8B92A5]' },
  connecting: {
    dot: 'bg-[#E5A93C] animate-pulse',
    label: 'Connecting',
    text: 'text-[#E5A93C]',
  },
  connected: { dot: 'bg-[#3ECF8E]', label: 'Live', text: 'text-[#3ECF8E]' },
  reconnecting: {
    dot: 'bg-[#E5A93C] animate-pulse',
    label: 'Reconnecting',
    text: 'text-[#E5A93C]',
  },
};

export function TopBar({
  projects,
  activeProjectId,
  sseState,
  exporting = false,
  importing = false,
  onSelectProject,
  onOpenAddProject,
  onOpenMcpConfig,
  onExportProject,
  onImportProjectFile,
  onOpenDeleteProject,
}: TopBarProps) {
  const sse = SSE_BADGE[sseState];
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#272B36] bg-[#181B22] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-6 w-6 place-items-center rounded border border-[#272B36] bg-[#111318]"
          >
            <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#6384FF]" />
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-[#E6E8EE]">
            VibeDeck
          </span>
          <span className="rounded border border-[#272B36] bg-[#111318] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[#8B92A5]">
            v0.1.2
          </span>
        </div>

        <span aria-hidden="true" className="h-4 w-px bg-[#272B36]" />

        <div className="relative flex items-center">
          <select
            aria-label="Active project"
            value={activeProjectId ?? ''}
            disabled={projects.length === 0}
            onChange={(e) => onSelectProject(e.target.value)}
            className="h-8 max-w-[240px] appearance-none rounded border border-[#272B36] bg-[#111318] pr-8 pl-2.5 text-[13px] font-medium text-[#E6E8EE] transition-colors hover:border-[#3A4052] focus:border-[#6384FF] focus:outline-none disabled:cursor-not-allowed disabled:text-[#8B92A5]"
          >
            {projects.length === 0 ? (
              <option value="">No projects yet</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))
            )}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8B92A5]"
          />
        </div>

        {activeProjectId && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenMcpConfig}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#8B92A5] transition-colors hover:border-[#3A4052] hover:bg-[#1F242E] hover:text-[#E6E8EE] focus-visible:outline-2 focus-visible:outline-[#6384FF]"
            >
              <Plug className="h-3.5 w-3.5 text-[#6384FF]" />
              <span>MCP Config</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              title="Export project & review history (JSON)"
              onClick={onExportProject}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#8B92A5] transition-colors hover:border-[#3A4052] hover:bg-[#1F242E] hover:text-[#E6E8EE] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-[#8B92A5]" />
              <span>{exporting ? 'Exporting…' : 'Export'}</span>
            </button>
            <button
              type="button"
              aria-label="Delete project"
              title="Delete active project"
              onClick={onOpenDeleteProject}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#272B36] bg-[#111318] text-[#8B92A5] transition-colors hover:border-[#E06C75]/50 hover:bg-[#E06C75]/10 hover:text-[#E06C75]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div
          title={`SSE connection: ${sse.label}`}
          className="flex items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-2.5 py-1 text-[12px]"
        >
          <span className={`h-2 w-2 rounded-full ${sse.dot}`} />
          <span className={`font-medium ${sse.text}`}>{sse.label}</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Import project JSON file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              onImportProjectFile(file);
            }
          }}
        />
        <button
          type="button"
          disabled={importing}
          title="Import exported project JSON"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-2.5 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:border-[#3A4052] hover:bg-[#1F242E] disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5 text-[#8B92A5]" />
          <span>{importing ? 'Importing…' : 'Import'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenAddProject}
          className="inline-flex h-8 items-center gap-1.5 rounded bg-[#6384FF] px-3 text-[13px] font-medium text-[#111318] transition-colors hover:bg-[#7A96FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6384FF]"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
          <span>Add Project</span>
        </button>
      </div>
    </header>
  );
}
