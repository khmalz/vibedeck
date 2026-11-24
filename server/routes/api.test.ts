import { afterAll, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/client';
import { createApp } from '../index';
import type { Group, PlanNode, Project, ProjectTree } from '../types';
import { createSseBroadcaster } from './sse';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-api-test-'));
const testDb: Database = createDb(path.join(tempDir, 'test.db'));
const broadcaster = createSseBroadcaster();
const app = createApp(testDb, broadcaster);
const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch: app.fetch,
});
const baseUrl = `http://127.0.0.1:${server.port}`;

interface SseFrame {
  event: string;
  data: string;
}

function createSseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readEvent = async (timeoutMs = 2000): Promise<SseFrame> => {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const normalized = buffer.replace(/\r\n/g, '\n');
      const sepIndex = normalized.indexOf('\n\n');
      if (sepIndex !== -1) {
        const rawFrame = normalized.slice(0, sepIndex);
        buffer = normalized.slice(sepIndex + 2);

        let event = 'message';
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        return { event, data: dataLines.join('\n') };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for SSE frame (buffer: ${JSON.stringify(buffer)})`);
      }

      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for SSE chunk')), remaining)
        ),
      ]);

      if (chunk.done) {
        throw new Error('SSE stream closed unexpectedly');
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };

  return {
    readEvent,
    cancel: () => reader.cancel(),
  };
}

async function apiJson<T>(urlPath: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

afterAll(() => {
  server.stop(true);
  testDb.close(false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('REST API & SSE Live Broadcaster', () => {
  test('supports REST CRUD, group deletion preserving nodes, review workflow, and project isolation', async () => {
    // 1. Create projects & validation
    const invalidJson = await apiJson<{ error: string }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(invalidJson.status).toBe(400);

    const createdA = await apiJson<{ project: Project }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Alpha', summary: 'Main deck' }),
    });
    expect(createdA.status).toBe(201);
    const projA = createdA.body.project;

    const createdB = await apiJson<{ project: Project }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Beta' }),
    });
    expect(createdB.status).toBe(201);
    const projB = createdB.body.project;

    const listed = await apiJson<{ projects: Project[] }>('/api/projects');
    expect(listed.status).toBe(200);
    expect(listed.body.projects.map((p) => p.id)).toContain(projA.id);
    expect(listed.body.projects.map((p) => p.id)).toContain(projB.id);

    // 2. Create group & seed nodes via MCP upsert_plan
    const groupRes = await apiJson<{ group: Group }>(`/api/projects/${projA.id}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Phase 1' }),
    });
    expect(groupRes.status).toBe(201);
    const groupA = groupRes.body.group;

    const mcpUpsert = await apiJson<{ result: { content: Array<{ text: string }> } }>(
      `/mcp/${projA.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'upsert_plan',
            arguments: {
              group_name: 'Phase 1',
              nodes: [
                {
                  node_type: 'module',
                  title: 'Core Module',
                  children: [{ node_type: 'task', title: 'Child Task' }],
                },
              ],
            },
          },
        }),
      }
    );
    expect(mcpUpsert.status).toBe(200);

    const treeRes = await apiJson<ProjectTree>(`/api/projects/${projA.id}/tree`);
    expect(treeRes.status).toBe(200);
    expect(treeRes.body.groups).toHaveLength(1);
    expect(treeRes.body.nodes).toHaveLength(2);
    const parentNode = treeRes.body.nodes.find((n) => n.title === 'Core Module')!;
    const childNode = treeRes.body.nodes.find((n) => n.title === 'Child Task')!;

    // 3. Patch, request-revision, approve, and cross-project rejection
    const crossPatch = await apiJson<{ error: string }>(
      `/api/projects/${projB.id}/nodes/${childNode.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Cross-project Hijack' }),
      }
    );
    expect(crossPatch.status).toBe(404);

    const patched = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projA.id}/nodes/${childNode.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Updated description',
          scope_files: ['server/routes/api.ts'],
          checklist: [{ text: 'Verify endpoint', checked: true }],
        }),
      }
    );
    expect(patched.status).toBe(200);
    expect(patched.body.node.description).toBe('Updated description');
    expect(patched.body.node.scope_files).toEqual(['server/routes/api.ts']);

    const badRevision = await apiJson<{ error: string }>(
      `/api/projects/${projA.id}/nodes/${childNode.id}/request-revision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_feedback: '   ' }),
      }
    );
    expect(badRevision.status).toBe(400);

    const revised = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projA.id}/nodes/${childNode.id}/request-revision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_feedback: 'Add 404 check' }),
      }
    );
    expect(revised.status).toBe(200);
    expect(revised.body.node.status).toBe('in_progress');
    expect(revised.body.node.human_feedback).toBe('Add 404 check');

    const approved = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projA.id}/nodes/${childNode.id}/approve`,
      { method: 'POST' }
    );
    expect(approved.status).toBe(200);
    expect(approved.body.node.status).toBe('done');

    // 4. Delete group -> group removed, nodes remain with group_id = null
    const delGroup = await apiJson<{ ok: boolean }>(
      `/api/projects/${projA.id}/groups/${groupA.id}`,
      { method: 'DELETE' }
    );
    expect(delGroup.status).toBe(200);

    const treeAfterGroupDel = await apiJson<ProjectTree>(`/api/projects/${projA.id}/tree`);
    expect(treeAfterGroupDel.body.groups).toHaveLength(0);
    expect(treeAfterGroupDel.body.nodes).toHaveLength(2);
    expect(treeAfterGroupDel.body.nodes.every((n) => n.group_id === null)).toBe(true);

    // 5. Delete parent node -> cascades to child node
    const delNode = await apiJson<{ ok: boolean }>(
      `/api/projects/${projA.id}/nodes/${parentNode.id}`,
      { method: 'DELETE' }
    );
    expect(delNode.status).toBe(200);
    const treeAfterNodeDel = await apiJson<ProjectTree>(`/api/projects/${projA.id}/tree`);
    expect(treeAfterNodeDel.body.nodes).toHaveLength(0);

    // 6. Delete projects & verify 404
    const delProjA = await apiJson<{ ok: boolean }>(`/api/projects/${projA.id}`, {
      method: 'DELETE',
    });
    expect(delProjA.status).toBe(200);
    await apiJson(`/api/projects/${projB.id}`, { method: 'DELETE' });

    const missingTree = await apiJson<{ error: string }>(`/api/projects/${projA.id}/tree`);
    expect(missingTree.status).toBe(404);
  });

  test('streams SSE connected and project_updated on REST and MCP mutations, and cleans up on abort', async () => {
    const unknownSse = await fetch(`${baseUrl}/api/projects/missing-id/events`);
    expect(unknownSse.status).toBe(404);

    const projA = (
      await apiJson<{ project: Project }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SSE Alpha' }),
      })
    ).body.project;

    const projB = (
      await apiJson<{ project: Project }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SSE Beta' }),
      })
    ).body.project;

    const controller = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/projects/${projA.id}/events`, {
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');

    const sse = createSseReader(sseRes.body!);

    try {
      // 1. Initial connected event
      const connected = await sse.readEvent();
      expect(connected.event).toBe('connected');
      expect(JSON.parse(connected.data)).toEqual({ ok: true, projectId: projA.id });
      expect(broadcaster.getSubscriberCount(projA.id)).toBe(1);

      // 2. REST mutation on projA -> immediate project_updated
      const groupRes = await apiJson<{ group: Group }>(`/api/projects/${projA.id}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Live Group' }),
      });
      expect(groupRes.status).toBe(201);

      const restEvent = await sse.readEvent();
      expect(restEvent.event).toBe('project_updated');
      expect(JSON.parse(restEvent.data).projectId).toBe(projA.id);

      // 3. Sibling projB mutation -> does NOT leak to projA stream
      await apiJson<{ group: Group }>(`/api/projects/${projB.id}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Beta Group' }),
      });

      // 4. MCP mutation on projA -> immediate project_updated (and confirms no projB event preceded it)
      const mcpRes = await apiJson<{ result: { content: Array<{ text: string }> } }>(
        `/mcp/${projA.id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'upsert_plan',
              arguments: {
                group_name: 'Live Group',
                nodes: [{ node_type: 'task', title: 'Live Task' }],
              },
            },
          }),
        }
      );
      expect(mcpRes.status).toBe(200);

      const mcpEvent = await sse.readEvent();
      expect(mcpEvent.event).toBe('project_updated');
      expect(JSON.parse(mcpEvent.data).projectId).toBe(projA.id);
    } finally {
      controller.abort();
      await sse.cancel().catch(() => {});
    }

    // Wait briefly for server stream.onAbort cleanup to execute
    for (let i = 0; i < 30; i++) {
      if (broadcaster.getSubscriberCount(projA.id) === 0) {
        break;
      }
      await Bun.sleep(15);
    }
    expect(broadcaster.getSubscriberCount(projA.id)).toBe(0);

    await apiJson(`/api/projects/${projA.id}`, { method: 'DELETE' });
    await apiJson(`/api/projects/${projB.id}`, { method: 'DELETE' });
  });
});
