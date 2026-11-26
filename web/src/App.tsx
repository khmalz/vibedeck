import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';
import {
  deleteGroup,
  deleteProject,
  exportProject,
  fetchProjects,
  fetchProjectTree,
  importProject,
  useProjectEvents,
} from './api/client';
import { AddProjectModal } from './components/AddProjectModal';
import { FractalTree } from './components/FractalTree';
import { InspectorPanel } from './components/InspectorPanel';
import { TopBar } from './components/TopBar';
import type { Group, PlanNode, Project } from './types';

const ACTIVE_PROJECT_KEY = 'vibedeck.activeProjectId';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    } catch {
      return null;
    }
  });
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [nodes, setNodes] = useState<PlanNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [exportingProject, setExportingProject] = useState(false);
  const [importingProject, setImportingProject] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const list = await fetchProjects();
      setProjects(list);
      setActiveProjectId((current) => {
        if (current && list.some((p) => p.id === current)) {
          return current;
        }
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setTreeError(
        err instanceof Error ? err.message : 'Failed to load projects.'
      );
    }
  }, []);

  const loadTree = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setActiveProject(null);
      setGroups([]);
      setNodes([]);
      setSelectedNodeId(null);
      return;
    }

    setLoadingTree(true);
    setTreeError(null);
    try {
      const tree = await fetchProjectTree(projectId);
      setActiveProject(tree.project);
      setGroups(tree.groups);
      setNodes(tree.nodes);
      setSelectedNodeId((current) =>
        current && tree.nodes.some((n) => n.id === current) ? current : null
      );
    } catch (err) {
      setTreeError(
        err instanceof Error ? err.message : 'Failed to load project tree.'
      );
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    try {
      if (activeProjectId) {
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
      } else {
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [activeProjectId]);

  useEffect(() => {
    void loadTree(activeProjectId);
  }, [activeProjectId, loadTree]);

  const handleProjectUpdated = useCallback(() => {
    void loadTree(activeProjectId);
  }, [activeProjectId, loadTree]);

  const sseState = useProjectEvents(activeProjectId, handleProjectUpdated);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedAncestors = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ancestors: PlanNode[] = [];
    let parentId = selectedNode.parent_id;
    let guard = 0;
    while (parentId && guard < 16) {
      const parent = byId.get(parentId);
      if (!parent) {
        break;
      }
      ancestors.unshift(parent);
      parentId = parent.parent_id;
      guard += 1;
    }
    return ancestors;
  }, [nodes, selectedNode]);

  const selectedGroupName = useMemo(() => {
    if (!selectedNode?.group_id) {
      return null;
    }
    return groups.find((g) => g.id === selectedNode.group_id)?.name ?? null;
  }, [groups, selectedNode]);

  const handleOpenAddProject = () => {
    setModalProject(null);
    setModalOpen(true);
  };

  const handleOpenMcpConfig = () => {
    if (!activeProject) {
      return;
    }
    setModalProject(activeProject);
    setModalOpen(true);
  };

  const handleProjectCreated = (project: Project) => {
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    setActiveProjectId(project.id);
    setSelectedNodeId(null);
  };

  const handleNodeUpdated = useCallback((updated: PlanNode) => {
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, []);

  const handleNodeDeleted = useCallback(
    (deletedId: string) => {
      setSelectedNodeId((current) => (current === deletedId ? null : current));
      void loadTree(activeProjectId);
    },
    [activeProjectId, loadTree]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      if (!activeProjectId) {
        return;
      }
      await deleteGroup(activeProjectId, groupId);
      await loadTree(activeProjectId);
    },
    [activeProjectId, loadTree]
  );

  const handleExportProject = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    setExportingProject(true);
    setTreeError(null);
    try {
      const bundle = await exportProject(activeProjectId);
      const slug =
        bundle.project.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'project';
      const dateTag = new Date().toISOString().slice(0, 10);
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vibedeck-${slug}-${dateTag}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setTreeError(
        err instanceof Error ? err.message : 'Failed to export project.'
      );
    } finally {
      setExportingProject(false);
    }
  }, [activeProjectId]);

  const handleImportProjectFile = useCallback(async (file: File) => {
    setImportingProject(true);
    setTreeError(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON.');
      }
      const res = await importProject(parsed);
      setProjects((prev) => [
        res.project,
        ...prev.filter((p) => p.id !== res.project.id),
      ]);
      setSelectedNodeId(null);
      setActiveProjectId(res.project.id);
    } catch (err) {
      setTreeError(
        err instanceof Error ? err.message : 'Failed to import project.'
      );
    } finally {
      setImportingProject(false);
    }
  }, []);

  const handleConfirmDeleteProject = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    setDeletingProject(true);
    setTreeError(null);
    try {
      await deleteProject(activeProjectId);
      const remaining = projects.filter((p) => p.id !== activeProjectId);
      setProjects(remaining);
      setSelectedNodeId(null);
      setActiveProjectId(remaining[0]?.id ?? null);
      setDeleteModalOpen(false);
    } catch (err) {
      setTreeError(
        err instanceof Error ? err.message : 'Failed to delete project.'
      );
    } finally {
      setDeletingProject(false);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!deleteModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deletingProject) {
        setDeleteModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteModalOpen, deletingProject]);

  return (
    <div className="flex h-screen flex-col bg-[#111318] text-[#E6E8EE]">
      <TopBar
        projects={projects}
        activeProjectId={activeProjectId}
        sseState={sseState}
        exporting={exportingProject}
        importing={importingProject}
        onSelectProject={(projectId) => {
          setSelectedNodeId(null);
          setActiveProjectId(projectId || null);
        }}
        onOpenAddProject={handleOpenAddProject}
        onOpenMcpConfig={handleOpenMcpConfig}
        onExportProject={handleExportProject}
        onImportProjectFile={handleImportProjectFile}
        onOpenDeleteProject={() => setDeleteModalOpen(true)}
      />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 w-full border-b border-[#272B36] lg:w-[55%] lg:border-r lg:border-b-0">
          <FractalTree
            project={activeProject}
            groups={groups}
            nodes={nodes}
            loading={loadingTree}
            error={treeError}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onOpenAddProject={handleOpenAddProject}
            onOpenMcpConfig={handleOpenMcpConfig}
            onDeleteGroup={handleDeleteGroup}
          />
        </div>

        <aside className="min-h-0 w-full overflow-y-auto bg-[#111318] p-5 lg:w-[45%]">
          <InspectorPanel
            projectId={activeProjectId}
            node={selectedNode}
            ancestors={selectedAncestors}
            groupName={selectedGroupName}
            onSelectNode={setSelectedNodeId}
            onNodeUpdated={handleNodeUpdated}
            onNodeDeleted={handleNodeDeleted}
          />
        </aside>
      </main>

      <AddProjectModal
        open={modalOpen}
        initialProject={modalProject}
        onClose={() => setModalOpen(false)}
        onCreated={handleProjectCreated}
      />

      {deleteModalOpen && activeProject && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete project"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingProject) {
              setDeleteModalOpen(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-md rounded-lg border border-[#272B36] bg-[#181B22] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#272B36] px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-[#E6E8EE]">
                Delete Project
              </h2>
              <button
                type="button"
                aria-label="Close delete dialog"
                disabled={deletingProject}
                onClick={() => setDeleteModalOpen(false)}
                className="rounded p-1 text-[#8B92A5] transition-colors hover:bg-[#1F242E] hover:text-[#E6E8EE]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-[13px] leading-relaxed text-[#8B92A5]">
                Delete{' '}
                <span className="font-semibold text-[#E6E8EE]">
                  {activeProject.name}
                </span>
                ? This removes {groups.length}{' '}
                {groups.length === 1 ? 'group' : 'groups'} and {nodes.length}{' '}
                {nodes.length === 1 ? 'node' : 'nodes'} (including review
                history) from SQLite.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={exportingProject || deletingProject}
                  onClick={handleExportProject}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#272B36] bg-[#111318] px-3 text-[12px] font-medium text-[#E6E8EE] transition-colors hover:bg-[#1F242E] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5 text-[#6384FF]" />
                  <span>
                    {exportingProject ? 'Exporting…' : 'Export backup first'}
                  </span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={deletingProject}
                    onClick={() => setDeleteModalOpen(false)}
                    className="h-8 rounded border border-[#272B36] px-3 text-[12px] font-medium text-[#8B92A5] hover:bg-[#1F242E] hover:text-[#E6E8EE]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deletingProject}
                    onClick={handleConfirmDeleteProject}
                    className="inline-flex h-8 items-center gap-1.5 rounded bg-[#E06C75] px-3 text-[12px] font-semibold text-[#111318] transition-colors hover:bg-[#E7838B] disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>
                      {deletingProject ? 'Deleting…' : 'Delete project'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
