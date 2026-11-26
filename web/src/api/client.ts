import { useEffect, useRef, useState } from 'react';
import type {
  ChecklistItem,
  Group,
  NodeStatus,
  PlanNode,
  Project,
  ProjectTree,
  SseConnectionState,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function fetchProjects(): Promise<Project[]> {
  const data = await requestJson<{ projects: Project[] }>('/api/projects');
  return data.projects;
}

export async function createProject(input: {
  name: string;
  summary?: string;
}): Promise<Project> {
  const data = await requestJson<{ project: Project }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}

export async function fetchProjectTree(projectId: string): Promise<ProjectTree> {
  return requestJson<ProjectTree>(
    `/api/projects/${encodeURIComponent(projectId)}/tree`
  );
}

export async function createGroup(
  projectId: string,
  input: { name: string; sort_order?: number }
): Promise<Group> {
  const data = await requestJson<{ group: Group }>(
    `/api/projects/${encodeURIComponent(projectId)}/groups`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return data.group;
}

export async function deleteGroup(
  projectId: string,
  groupId: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' }
  );
}

export async function patchNode(
  projectId: string,
  nodeId: string,
  patch: {
    title?: string;
    description?: string;
    status?: NodeStatus;
    scope_files?: string[];
    rules?: string;
    checklist?: ChecklistItem[];
    human_feedback?: string;
  }
): Promise<PlanNode> {
  const data = await requestJson<{ node: PlanNode }>(
    `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
  return data.node;
}

export async function approveNode(
  projectId: string,
  nodeId: string,
  comment?: string
): Promise<PlanNode> {
  const trimmed = comment?.trim();
  const data = await requestJson<{ node: PlanNode }>(
    `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/approve`,
    trimmed
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: trimmed }),
        }
      : { method: 'POST' }
  );
  return data.node;
}

export async function requestNodeRevision(
  projectId: string,
  nodeId: string,
  humanFeedback: string
): Promise<PlanNode> {
  const data = await requestJson<{ node: PlanNode }>(
    `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/request-revision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ human_feedback: humanFeedback }),
    }
  );
  return data.node;
}

export async function deleteNode(
  projectId: string,
  nodeId: string
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' }
  );
}

/** Subscribe to per-project SSE events and trigger live tree refreshes without reconnecting on callback changes. */
export function useProjectEvents(
  projectId: string | null,
  onProjectUpdated: () => void
): SseConnectionState {
  const [status, setStatus] = useState<SseConnectionState>(
    projectId ? 'connecting' : 'idle'
  );
  const callbackRef = useRef(onProjectUpdated);
  callbackRef.current = onProjectUpdated;

  useEffect(() => {
    if (!projectId) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    const source = new EventSource(
      `/api/projects/${encodeURIComponent(projectId)}/events`
    );

    const handleConnected = () => setStatus('connected');
    const handleProjectUpdated = () => {
      callbackRef.current();
    };

    source.onopen = handleConnected;
    source.addEventListener('connected', handleConnected);
    source.addEventListener('project_updated', handleProjectUpdated);
    source.onerror = () => {
      setStatus('reconnecting');
    };

    return () => {
      source.removeEventListener('connected', handleConnected);
      source.removeEventListener('project_updated', handleProjectUpdated);
      source.close();
    };
  }, [projectId]);

  return status;
}
