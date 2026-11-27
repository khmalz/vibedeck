import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/client';
import { getNodeById } from '../db/queries';
import { initSchema } from '../db/schema';
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

afterAll(async () => {
  await server.stop(true);
  testDb.close(false);
  try {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch {
    // Windows may hold WAL shm handle briefly until process exit
  }
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

  test('migrates legacy v0.0.1 SQLite schema without review_history safely and backfills entries', () => {
    const legacyDbPath = path.join(tempDir, 'legacy-v001.db');
    const legacyDb = new Database(legacyDbPath, { create: true, strict: true });

    try {
      legacyDb.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          summary TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE groups (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE nodes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
          parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
          node_type TEXT NOT NULL CHECK (node_type IN ('module', 'task', 'revision')),
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'needs_review', 'done')),
          scope_files TEXT NOT NULL DEFAULT '[]',
          rules TEXT DEFAULT '',
          checklist TEXT NOT NULL DEFAULT '[]',
          ai_report TEXT DEFAULT '',
          human_feedback TEXT DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      legacyDb.run(
        `INSERT INTO projects (id, name, summary, created_at, updated_at) VALUES ('p1', 'Legacy Project', '', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`
      );
      legacyDb.run(
        `INSERT INTO nodes (id, project_id, node_type, title, description, status, checklist, ai_report, human_feedback, sort_order, created_at, updated_at)
         VALUES
           ('n-review', 'p1', 'task', 'Needs Rev Node', 'Original plan', 'needs_review', '[{"text":"Item 1","checked":true}]', 'Updated implementation', 'Old feedback round 1', 0, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
           ('n-prog', 'p1', 'task', 'In Progress Node', 'Active plan', 'in_progress', '[]', 'First attempt', 'Pending fix', 1, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
           ('n-done', 'p1', 'task', 'Done Node', 'Finished plan', 'done', '[]', 'Final report', 'Prior comment', 2, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`
      );

      // Run idempotent schema init twice
      initSchema(legacyDb);
      initSchema(legacyDb);

      const reviewNode = getNodeById('p1', 'n-review', legacyDb)!;
      expect(reviewNode.description).toBe('Original plan');
      expect(reviewNode.checklist).toEqual([{ text: 'Item 1', checked: true }]);
      expect(reviewNode.human_feedback).toBe('');
      expect(reviewNode.review_history.map((e) => e.type)).toEqual([
        'human_feedback',
        'ai_report',
      ]);
      expect(reviewNode.review_history[0]?.content).toBe('Old feedback round 1');

      const progNode = getNodeById('p1', 'n-prog', legacyDb)!;
      expect(progNode.human_feedback).toBe('Pending fix');
      expect(progNode.review_history.map((e) => e.type)).toEqual([
        'ai_report',
        'human_feedback',
      ]);

      const doneNode = getNodeById('p1', 'n-done', legacyDb)!;
      expect(doneNode.human_feedback).toBe('');
      expect(doneNode.review_history.map((e) => e.type)).toEqual([
        'human_feedback',
        'ai_report',
        'approved',
      ]);
    } finally {
      legacyDb.close(false);
    }
  });

  test('exports full project history, restores deleted project with original IDs, and remaps IDs on duplicate import', async () => {
    const created = await apiJson<{ project: Project }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Archive Me', summary: 'Portable deck' }),
    });
    expect(created.status).toBe(201);
    const proj = created.body.project;

    await apiJson(`/mcp/${proj.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'upsert_plan',
          arguments: {
            group_name: 'Phase 1',
            nodes: [
              {
                node_type: 'module',
                title: 'Parent Mod',
                children: [
                  {
                    node_type: 'task',
                    title: 'Leaf Task',
                    checklist: ['Step 1'],
                  },
                ],
              },
            ],
          },
        },
      }),
    });

    const treeBefore = (await apiJson<ProjectTree>(`/api/projects/${proj.id}/tree`)).body;
    const leaf = treeBefore.nodes.find((n) => n.title === 'Leaf Task')!;

    await apiJson(`/api/projects/${proj.id}/nodes/${leaf.id}/request-revision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ human_feedback: 'Keep export timeline intact' }),
    });

    const exportedRes = await fetch(`${baseUrl}/api/projects/${proj.id}/export`);
    expect(exportedRes.status).toBe(200);
    expect(exportedRes.headers.get('content-disposition')).toContain(
      'vibedeck-archive-me.json'
    );
    const bundle = (await exportedRes.json()) as {
      format: string;
      schema_version: number;
      project: Project;
      groups: Group[];
      nodes: PlanNode[];
    };
    expect(bundle.format).toBe('vibedeck-project-export');
    expect(bundle.schema_version).toBe(1);
    expect(bundle.nodes).toHaveLength(2);

    // Reverse node order so child appears before parent to verify topological FK insert
    const reversedBundle = {
      ...bundle,
      nodes: [...bundle.nodes].reverse(),
    };

    // Delete original project -> restore with original IDs (id_remapped: false)
    const deleted = await apiJson<{ ok: boolean }>(`/api/projects/${proj.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);

    const restored = await apiJson<{
      project: Project;
      imported_groups: number;
      imported_nodes: number;
      id_remapped: boolean;
    }>('/api/projects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reversedBundle),
    });
    expect(restored.status).toBe(201);
    expect(restored.body.project.id).toBe(proj.id);
    expect(restored.body.id_remapped).toBe(false);
    expect(restored.body.imported_groups).toBe(1);
    expect(restored.body.imported_nodes).toBe(2);

    const restoredTree = (await apiJson<ProjectTree>(`/api/projects/${proj.id}/tree`)).body;
    const restoredLeaf = restoredTree.nodes.find((n) => n.title === 'Leaf Task')!;
    expect(restoredLeaf.review_history).toHaveLength(1);
    expect(restoredLeaf.review_history[0]?.content).toBe('Keep export timeline intact');

    // Re-importing while original exists remaps IDs without collision
    const duplicate = await apiJson<{
      project: Project;
      imported_groups: number;
      imported_nodes: number;
      id_remapped: boolean;
    }>('/api/projects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id_remapped).toBe(true);
    expect(duplicate.body.project.id).not.toBe(proj.id);

    const dupTree = (
      await apiJson<ProjectTree>(`/api/projects/${duplicate.body.project.id}/tree`)
    ).body;
    expect(dupTree.nodes).toHaveLength(2);
    const dupParent = dupTree.nodes.find((n) => n.title === 'Parent Mod')!;
    const dupLeaf = dupTree.nodes.find((n) => n.title === 'Leaf Task')!;
    expect(dupLeaf.parent_id).toBe(dupParent.id);

    const badImport = await apiJson<{ error: string }>('/api/projects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'wrong' }),
    });
    expect(badImport.status).toBe(400);

    await apiJson(`/api/projects/${proj.id}`, { method: 'DELETE' });
    await apiJson(`/api/projects/${duplicate.body.project.id}`, { method: 'DELETE' });
  });

  test('cascades done status to unfinished descendants and rolls up ancestors', async () => {
    const createdProj = await apiJson<{ project: { id: string } }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cascade Done Test Project' }),
    });
    expect(createdProj.status).toBe(201);
    const projectId = createdProj.body.project.id;

    const seedRes = await apiJson<{ result: { content: Array<{ text: string }> } }>(
      `/mcp/${projectId}`,
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
                  title: 'Root Module',
                  children: [
                    {
                      node_type: 'module',
                      title: 'Sub Module',
                      children: [
                        { node_type: 'task', title: 'Task A' },
                        { node_type: 'task', title: 'Task B' },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        }),
      }
    );
    expect(seedRes.status).toBe(200);

    const seededTree = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    expect(seededTree.status).toBe(200);
    const rootMod = seededTree.body.nodes.find((n) => n.title === 'Root Module')!;
    const subMod = seededTree.body.nodes.find((n) => n.title === 'Sub Module')!;
    const taskA = seededTree.body.nodes.find((n) => n.title === 'Task A')!;
    const taskB = seededTree.body.nodes.find((n) => n.title === 'Task B')!;
    expect(rootMod).toBeDefined();
    expect(subMod).toBeDefined();
    expect(taskA).toBeDefined();
    expect(taskB).toBeDefined();

    // Give Task B pending human_feedback
    const taskBRev = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${taskB.id}/request-revision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_feedback: 'Needs extra check' }),
      }
    );
    expect(taskBRev.status).toBe(200);
    expect(taskBRev.body.node.human_feedback).toBe('Needs extra check');

    // Mark Sub Module as done via PATCH -> Task A, Task B, and Root Module must become done
    const patchedSub = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${subMod.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }
    );
    expect(patchedSub.status).toBe(200);
    expect(patchedSub.body.node.status).toBe('done');

    const treeAfterPatch = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    expect(treeAfterPatch.status).toBe(200);

    const byId = new Map(treeAfterPatch.body.nodes.map((n) => [n.id, n]));
    expect(byId.get(subMod.id)?.status).toBe('done');
    expect(byId.get(rootMod.id)?.status).toBe('done');
    expect(byId.get(taskA.id)?.status).toBe('done');
    expect(byId.get(taskB.id)?.status).toBe('done');
    expect(byId.get(taskB.id)?.human_feedback).toBe('');
    expect(
      byId.get(taskA.id)?.review_history.some(
        (h) => h.type === 'approved' && h.content === 'Marked done via parent'
      )
    ).toBe(true);
    expect(
      byId.get(taskB.id)?.review_history.some(
        (h) => h.type === 'approved' && h.content === 'Marked done via parent'
      )
    ).toBe(true);

    // Also verify approve endpoint cascades to unfinished descendants
    const seedTaskC = await apiJson<{ result: { content: Array<{ text: string }> } }>(
      `/mcp/${projectId}`,
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
              group_name: 'Phase 1',
              nodes: [
                {
                  id: subMod.id,
                  node_type: 'module',
                  title: 'Sub Module',
                  children: [{ node_type: 'task', title: 'Task C' }],
                },
              ],
            },
          },
        }),
      }
    );
    expect(seedTaskC.status).toBe(200);

    const treeBeforeApprove = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    const taskC = treeBeforeApprove.body.nodes.find((n) => n.title === 'Task C')!;
    expect(taskC).toBeDefined();
    expect(taskC.status).toBe('planned');

    const approvedSub = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${subMod.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    expect(approvedSub.status).toBe(200);
    expect(approvedSub.body.node.status).toBe('done');

    const treeAfterApprove = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    const byIdAfterApprove = new Map(treeAfterApprove.body.nodes.map((n) => [n.id, n]));
    expect(byIdAfterApprove.get(taskC.id)?.status).toBe('done');
    expect(byIdAfterApprove.get(rootMod.id)?.status).toBe('done');

    await apiJson(`/api/projects/${projectId}`, { method: 'DELETE' });
  });

  test('migrates legacy schema without previous_status safely and supports AI-safe reopen undo', async () => {
    const legacyDbPath = path.join(tempDir, 'legacy-prev-status.db');
    const legacyDb = new Database(legacyDbPath, { create: true, strict: true });

    try {
      legacyDb.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          summary TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE groups (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE nodes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
          parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
          node_type TEXT NOT NULL CHECK (node_type IN ('module', 'task', 'revision')),
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'needs_review', 'done')),
          scope_files TEXT NOT NULL DEFAULT '[]',
          rules TEXT DEFAULT '',
          checklist TEXT NOT NULL DEFAULT '[]',
          ai_report TEXT DEFAULT '',
          human_feedback TEXT DEFAULT '',
          review_history TEXT NOT NULL DEFAULT '[]',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      legacyDb.run(
        `INSERT INTO projects (id, name, summary, created_at, updated_at) VALUES ('p-prev', 'Prev Project', '', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`
      );
      legacyDb.run(
        `INSERT INTO nodes (id, project_id, node_type, title, status, ai_report, sort_order, created_at, updated_at)
         VALUES ('n-legacy-done', 'p-prev', 'task', 'Legacy Done Task', 'done', 'Completed work', 0, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`
      );

      initSchema(legacyDb);
      const cols = legacyDb
        .query<{ name: string }, []>('PRAGMA table_info(nodes)')
        .all()
        .map((c) => c.name);
      expect(cols).toContain('previous_status');

      const legacyNode = getNodeById('p-prev', 'n-legacy-done', legacyDb)!;
      expect(legacyNode.previous_status).toBeNull();
    } finally {
      legacyDb.close(false);
    }

    // Full HTTP + MCP lifecycle for leaf undo, reopen with reason, parent selective undo, and 400 guard
    const createdProj = await apiJson<{ project: { id: string } }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reopen Test Project' }),
    });
    expect(createdProj.status).toBe(201);
    const projectId = createdProj.body.project.id;

    const seedRes = await apiJson<{ result: { content: Array<{ text: string }> } }>(
      `/mcp/${projectId}`,
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
                  title: 'Parent Mod',
                  children: [
                    { node_type: 'task', title: 'Task 1' },
                    { node_type: 'task', title: 'Task 2' },
                  ],
                },
              ],
            },
          },
        }),
      }
    );
    expect(seedRes.status).toBe(200);

    const tree1 = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    const parentMod = tree1.body.nodes.find((n) => n.title === 'Parent Mod')!;
    const task1 = tree1.body.nodes.find((n) => n.title === 'Task 1')!;
    const task2 = tree1.body.nodes.find((n) => n.title === 'Task 2')!;

    // Reopening a non-done node must return HTTP 400
    const nonDoneReopen = await apiJson<{ error: string }>(
      `/api/projects/${projectId}/nodes/${task1.id}/reopen`,
      { method: 'POST' }
    );
    expect(nonDoneReopen.status).toBe(400);

    // Move Task 1 through start_node -> submit_for_review -> needs_review -> approve (done)
    await apiJson(`/mcp/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'start_node', arguments: { node_id: task1.id } },
      }),
    });
    await apiJson(`/mcp/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'submit_for_review',
          arguments: { node_id: task1.id, ai_report: 'Implemented Task 1' },
        },
      }),
    });

    const approvedTask1 = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${task1.id}/approve`,
      { method: 'POST' }
    );
    expect(approvedTask1.status).toBe(200);
    expect(approvedTask1.body.node.status).toBe('done');
    expect(approvedTask1.body.node.previous_status).toBe('needs_review');

    // 1) Undo without reason -> restores exact needs_review, clears previous_status, empty human_feedback, appends reopened
    const undoneTask1 = await apiJson<{ node: PlanNode; reopened_count: number }>(
      `/api/projects/${projectId}/nodes/${task1.id}/reopen`,
      { method: 'POST' }
    );
    expect(undoneTask1.status).toBe(200);
    expect(undoneTask1.body.reopened_count).toBe(1);
    expect(undoneTask1.body.node.status).toBe('needs_review');
    expect(undoneTask1.body.node.previous_status).toBeNull();
    expect(undoneTask1.body.node.human_feedback).toBe('');
    expect(undoneTask1.body.node.review_history.at(-1)?.type).toBe('reopened');
    expect(undoneTask1.body.node.review_history.at(-1)?.content).toContain(
      'human undo — no revision requested'
    );

    // Check MCP get_node_context renders **Reopened**
    const ctxAfterUndo = await apiJson<{ result: { content: Array<{ text: string }> } }>(
      `/mcp/${projectId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'get_node_context', arguments: { node_id: task1.id } },
        }),
      }
    );
    expect(ctxAfterUndo.body.result.content[0]?.text).toContain('**Reopened**');

    // 2) Approve Task 1 again, then reopen WITH reason -> sets in_progress + human_feedback, parent rolls up to in_progress
    await apiJson(`/api/projects/${projectId}/nodes/${task1.id}/approve`, {
      method: 'POST',
    });
    const reopenedWithReason = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${task1.id}/reopen`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Edge case fails on empty payload' }),
      }
    );
    expect(reopenedWithReason.status).toBe(200);
    expect(reopenedWithReason.body.node.status).toBe('in_progress');
    expect(reopenedWithReason.body.node.previous_status).toBeNull();
    expect(reopenedWithReason.body.node.human_feedback).toBe(
      'Edge case fails on empty payload'
    );
    expect(reopenedWithReason.body.node.review_history.at(-1)?.type).toBe('reopened');

    // PATCHing status -> done clears stale human_feedback and appends Approved (Done)
    const patchedToDone = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${task1.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }
    );
    expect(patchedToDone.status).toBe(200);
    expect(patchedToDone.body.node.status).toBe('done');
    expect(patchedToDone.body.node.previous_status).toBe('in_progress');
    expect(patchedToDone.body.node.human_feedback).toBe('');
    expect(patchedToDone.body.node.review_history.at(-1)?.type).toBe('approved');
    expect(patchedToDone.body.node.review_history.at(-1)?.content).toBe('Approved (Done)');

    // 3) Parent cascade Done + Reopen (cascade_scope default preserves earlier legitimately done Task 1)
    // First approve Task 1 legitimately while Task 2 remains planned
    await apiJson(`/api/projects/${projectId}/nodes/${task1.id}/approve`, {
      method: 'POST',
    });
    // Now mark Parent Mod Done (cascades Done to Task 2, saving previous_status = 'planned')
    const parentDone = await apiJson<{ node: PlanNode }>(
      `/api/projects/${projectId}/nodes/${parentMod.id}/approve`,
      { method: 'POST' }
    );
    expect(parentDone.status).toBe(200);
    expect(parentDone.body.node.status).toBe('done');

    const treeWhileDone = await apiJson<ProjectTree>(`/api/projects/${projectId}/tree`);
    const task2Cascaded = treeWhileDone.body.nodes.find((n) => n.id === task2.id)!;
    expect(task2Cascaded.status).toBe('done');
    expect(task2Cascaded.previous_status).toBe('planned');

    // Reopen Parent Mod with default scope -> reverts only cascaded Task 2 back to 'planned', keeps Task 1 'done', Parent Mod becomes 'in_progress'
    const parentReopened = await apiJson<{ node: PlanNode; reopened_count: number }>(
      `/api/projects/${projectId}/nodes/${parentMod.id}/reopen`,
      { method: 'POST' }
    );
    expect(parentReopened.status).toBe(200);
    expect(parentReopened.body.reopened_count).toBe(2);
    expect(parentReopened.body.node.status).toBe('in_progress');

    const treeAfterParentReopen = await apiJson<ProjectTree>(
      `/api/projects/${projectId}/tree`
    );
    const byIdAfter = new Map(treeAfterParentReopen.body.nodes.map((n) => [n.id, n]));
    expect(byIdAfter.get(task1.id)?.status).toBe('done');
    expect(byIdAfter.get(task2.id)?.status).toBe('planned');
    expect(byIdAfter.get(task2.id)?.previous_status).toBeNull();
    expect(byIdAfter.get(parentMod.id)?.status).toBe('in_progress');

    await apiJson(`/api/projects/${projectId}`, { method: 'DELETE' });
  });
});
