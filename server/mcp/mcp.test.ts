import { afterAll, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/client';
import {
  createProject,
  getNodeById,
  listProjects,
  updateNode,
} from '../db/queries';
import { createApp } from '../index';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-mcp-test-'));
const testDb: Database = createDb(path.join(tempDir, 'test.db'));
const app = createApp(testDb);

const projectA = createProject({ name: 'Alpha App', summary: 'Primary test project' }, testDb);
const projectB = createProject({ name: 'Beta App', summary: 'Isolated sibling project' }, testDb);

let reqSeq = 1;

async function mcpPost(projectId: string, method: string, params?: Record<string, unknown>) {
  const response = await app.request(`http://localhost/mcp/${projectId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: reqSeq++,
      method,
      params,
    }),
  });
  const body = (await response.json()) as Record<string, any>;
  return { status: response.status, body };
}

async function callTool(projectId: string, name: string, args: Record<string, unknown>) {
  const { status, body } = await mcpPost(projectId, 'tools/call', {
    name,
    arguments: args,
  });
  expect(status).toBe(200);
  const result = body.result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return {
    isError: Boolean(result?.isError),
    text: result?.content?.[0]?.text ?? '',
  };
}

afterAll(() => {
  testDb.close(false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('MCP Streamable HTTP (/mcp/:projectId)', () => {
  test('returns 404 JSON on unknown projectId without auto-creating a project', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000999';
    const countBefore = listProjects(testDb).length;
    const { status, body } = await mcpPost(unknownId, 'tools/list');

    expect(status).toBe(404);
    expect(body.error).toContain(unknownId);
    expect(listProjects(testDb).length).toBe(countBefore);
  });

  test('initialize includes instructions and tools/list exposes 6 scoped tools with recursive upsert_plan schema', async () => {
    const init = await mcpPost(projectA.id, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'vibedeck-test', version: '0.1.0' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toContain('get_project_tree');
    expect(init.body.result.instructions).toContain('submit_for_review');

    const listed = await mcpPost(projectA.id, 'tools/list');
    expect(listed.status).toBe(200);
    const tools = listed.body.result.tools as Array<Record<string, any>>;
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      'add_revision',
      'get_node_context',
      'get_project_tree',
      'start_node',
      'submit_for_review',
      'upsert_plan',
    ]);
    expect(names).not.toContain('list_projects');

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('get_project_tree')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_node_context')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('upsert_plan')?.annotations?.readOnlyHint).toBe(false);

    const upsertSchema = JSON.stringify(byName.get('upsert_plan')?.inputSchema);
    expect(upsertSchema).toContain('$ref');
    expect(upsertSchema).toContain('children');
  });

  test('executes full lifecycle across all 6 MCP tools and enforces cross-project isolation', async () => {
    // 1. upsert_plan: 3-level hierarchy (module -> module -> task)
    const upsert1 = await callTool(projectA.id, 'upsert_plan', {
      group_name: 'Phase 1',
      nodes: [
        {
          node_type: 'module',
          title: 'Backend Core',
          description: 'Core HTTP and DB layer',
          scope_files: ['server/index.ts'],
          rules: 'Use Bun native APIs only.',
          children: [
            {
              node_type: 'module',
              title: 'Auth Submodule',
              rules: 'Validate tokens strictly.',
              children: [
                {
                  node_type: 'task',
                  title: 'Implement Session Guard',
                  description: 'Protect private endpoints',
                  scope_files: ['server/auth/guard.ts'],
                  checklist: ['Create middleware', 'Add unit test'],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(upsert1.isError).toBe(false);
    expect(upsert1.text).toContain('# Plan Upserted — Phase 1');
    expect(upsert1.text).toContain('Created: 3 | Updated: 0');
    expect(upsert1.text).not.toContain('nesting reached');

    // Extract IDs from Markdown output
    const backendIdMatch = upsert1.text.match(/\(module\) Backend Core — id:([^\s]+)/);
    const authIdMatch = upsert1.text.match(/\(module\) Auth Submodule — id:([^\s]+)/);
    const taskIdMatch = upsert1.text.match(/\(task\) Implement Session Guard — id:([^\s]+)/);
    expect(backendIdMatch).not.toBeNull();
    expect(authIdMatch).not.toBeNull();
    expect(taskIdMatch).not.toBeNull();
    const backendId = backendIdMatch![1]!;
    const authId = authIdMatch![1]!;
    const taskId = taskIdMatch![1]!;

    // Update existing hierarchy by id in-place + test soft depth warning (>3 levels)
    const upsert2 = await callTool(projectA.id, 'upsert_plan', {
      group_name: 'Phase 1',
      nodes: [
        {
          node_type: 'module',
          title: 'L1',
          children: [
            {
              node_type: 'module',
              title: 'L2',
              children: [
                {
                  node_type: 'module',
                  title: 'L3',
                  children: [{ node_type: 'task', title: 'L4 Deep Task' }],
                },
              ],
            },
          ],
        },
        {
          id: backendId,
          node_type: 'module',
          title: 'Backend Core',
          children: [
            {
              id: authId,
              node_type: 'module',
              title: 'Auth Submodule',
              children: [
                {
                  id: taskId,
                  node_type: 'task',
                  title: 'Implement Session Guard v2',
                  checklist: ['Create middleware', 'Add unit test', 'Document edge case'],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(upsert2.isError).toBe(false);
    expect(upsert2.text).toContain('Updated: 3');
    expect(upsert2.text).toContain('nesting reached 4 levels');

    // 2. get_project_tree (unfiltered & filtered)
    const treeAll = await callTool(projectA.id, 'get_project_tree', {});
    expect(treeAll.isError).toBe(false);
    expect(treeAll.text).toContain('# Alpha App');
    expect(treeAll.text).toContain('## Phase 1');
    expect(treeAll.text).toContain('[planned] (task) Implement Session Guard v2');

    const treeDone = await callTool(projectA.id, 'get_project_tree', {
      status_filter: 'done',
    });
    expect(treeDone.isError).toBe(false);
    expect(treeDone.text).toContain('No nodes matching status `done`');

    // Seed human_feedback to verify start_node returns it
    updateNode(projectA.id, taskId, { human_feedback: 'Handle expired cookies cleanly.' }, testDb);

    // 3. get_node_context (target + inherited ancestors)
    const ctx = await callTool(projectA.id, 'get_node_context', { node_id: taskId });
    expect(ctx.isError).toBe(false);
    expect(ctx.text).toContain('# Implement Session Guard v2');
    expect(ctx.text).toContain('Backend Core');
    expect(ctx.text).toContain('Auth Submodule');
    expect(ctx.text).toContain('Use Bun native APIs only.');
    expect(ctx.text).toContain('Validate tokens strictly.');

    // 4. start_node
    const started = await callTool(projectA.id, 'start_node', { node_id: taskId });
    expect(started.isError).toBe(false);
    expect(started.text).toContain('Status: `in_progress`');
    expect(started.text).toContain('Handle expired cookies cleanly.');
    expect(getNodeById(projectA.id, taskId, testDb)?.status).toBe('in_progress');

    // 5. add_revision
    const rev = await callTool(projectA.id, 'add_revision', {
      parent_node_id: taskId,
      title: 'Fix Cookie Expiry Edge Case',
      description: 'Reject negative maxAge values',
      checklist: ['Add boundary check'],
    });
    expect(rev.isError).toBe(false);
    expect(rev.text).toContain('# Revision Created — Fix Cookie Expiry Edge Case');
    const revIdMatch = rev.text.match(/Revision ID: `([^`]+)`/);
    expect(revIdMatch).not.toBeNull();
    const revNode = getNodeById(projectA.id, revIdMatch![1]!, testDb);
    expect(revNode?.node_type).toBe('revision');
    expect(revNode?.status).toBe('planned');
    expect(revNode?.parent_id).toBe(taskId);
    expect(revNode?.group_id).toBe(getNodeById(projectA.id, taskId, testDb)?.group_id);

    // 6. submit_for_review (mark checklist items by 0-based index and text)
    const review = await callTool(projectA.id, 'submit_for_review', {
      node_id: taskId,
      ai_report: 'Implemented session guard and tests.',
      checked_items: ['0', 'Add unit test'],
    });
    expect(review.isError).toBe(false);
    expect(review.text).toContain('# Submitted for Review — Implement Session Guard v2');
    expect(review.text).toContain('Checklist: 2/3 completed.');

    const updatedTask = getNodeById(projectA.id, taskId, testDb)!;
    expect(updatedTask.status).toBe('needs_review');
    expect(updatedTask.ai_report).toBe('Implemented session guard and tests.');
    expect(updatedTask.checklist).toEqual([
      { text: 'Create middleware', checked: true },
      { text: 'Add unit test', checked: true },
      { text: 'Document edge case', checked: false },
    ]);

    // 7. Cross-project isolation from Project B against Project A's taskId
    const bCtx = await callTool(projectB.id, 'get_node_context', { node_id: taskId });
    expect(bCtx.isError).toBe(true);

    const bStart = await callTool(projectB.id, 'start_node', { node_id: taskId });
    expect(bStart.isError).toBe(true);

    const bRev = await callTool(projectB.id, 'add_revision', {
      parent_node_id: taskId,
      title: 'Cross-project probe',
      description: 'Should fail',
    });
    expect(bRev.isError).toBe(true);

    const bSubmit = await callTool(projectB.id, 'submit_for_review', {
      node_id: taskId,
      ai_report: 'Cross-project overwrite attempt',
    });
    expect(bSubmit.isError).toBe(true);

    // Passing Project A's taskId into Project B's upsert_plan must NOT modify Project A's node
    const bUpsert = await callTool(projectB.id, 'upsert_plan', {
      group_name: 'Beta Phase',
      nodes: [{ id: taskId, node_type: 'task', title: 'Hijacked Title' }],
    });
    expect(bUpsert.isError).toBe(false);
    expect(getNodeById(projectA.id, taskId, testDb)?.title).toBe('Implement Session Guard v2');
  });
});
