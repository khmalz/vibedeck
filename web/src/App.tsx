import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteGroup,
  fetchProjects,
  fetchProjectTree,
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

  return (
    <div className="flex h-screen flex-col bg-[#111318] text-[#E6E8EE]">
      <TopBar
        projects={projects}
        activeProjectId={activeProjectId}
        sseState={sseState}
        onSelectProject={(projectId) => {
          setSelectedNodeId(null);
          setActiveProjectId(projectId || null);
        }}
        onOpenAddProject={handleOpenAddProject}
        onOpenMcpConfig={handleOpenMcpConfig}
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
    </div>
  );
}
