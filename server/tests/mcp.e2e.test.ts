import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../db/client';
import { createProject, getNodeById, listProjects } from '../db/queries';
import { createApp } from '../index';
import { createSseBroadcaster } from '../routes/sse';

let tempDir = '';
let testDb: Database;
let broadcaster: ReturnType<typeof createSseBroadcaster>;
let server: ReturnType<typeof Bun.serve>;
let baseUrl = '';

const connectedClients: Client[] = [];

async function connectMcpClient(projectId: string): Promise<Client> {
  const client = new Client({
    name: 'vibedeck-e2e-client',
    version: '0.1.0',
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp/${projectId}`)
  );
  await client.connect(transport);
  connectedClients.push(client);
  return client;
}

function extractText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? '';
}

function createSseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readEvent = async (
    timeoutMs = 2500
  ): Promise<{ event: string; data: string }> => {
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
        throw new Error(`Timed out waiting for SSE event (buffer=${JSON.stringify(buffer)})`);
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

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-mcp-e2e-'));
  const dbPath = path.join(tempDir, 'e2e.db');
  process.env.VIBEDECK_DB_PATH = dbPath;

  testDb = createDb(dbPath);
  broadcaster = createSseBroadcaster();
  const app = createApp(testDb, broadcaster);

  server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: app.fetch,
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await Promise.all(
    connectedClients.map((client) => client.close().catch(() => {}))
  );
  server.stop(true);
  testDb.close(false);
  fs.rmSync(tempDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

describe('VibeDeck MCP Client E2E Integration', () => {
  test('rejects unknown :projectId with HTTP 404 and never auto-creates a project', async () => {
    const unknownId = 'non-existent-uuid';
    const projectCountBefore = listProjects(testDb).length;

    const client = new Client({
      name: 'vibedeck-e2e-invalid',
      version: '0.1.0',
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp/${unknownId}`)
    );

    let caught: unknown;
    try {
      await client.connect(transport);
    } catch (err) {
      caught = err;
    } finally {
      await client.close().catch(() => {});
    }

    expect(caught).toBeInstanceOf(StreamableHTTPError);
    expect((caught as StreamableHTTPError).code).toBe(404);
    expect(listProjects(testDb).length).toBe(projectCountBefore);
  });

  test('executes handshake, full 6-tool lifecycle, cross-project isolation, and live SSE triggers', async () => {
    const projectA = createProject(
      { name: 'E2E Project A', summary: 'Primary MCP client E2E project' },
      testDb
    );
    const projectB = createProject(
      { name: 'E2E Project B', summary: 'Isolated sibling project' },
      testDb
    );

    // 1. Handshake & tool discovery via real MCP Client
    const clientA = await connectMcpClient(projectA.id);
    const instructions = clientA.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions).toContain('get_project_tree');
    expect(instructions).toContain('upsert_plan');
    expect(instructions).toContain('start_node');
    expect(instructions).toContain('add_revision');
    expect(instructions).toContain('submit_for_review');

    const { tools } = await clientA.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'add_revision',
      'get_node_context',
      'get_project_tree',
      'start_node',
      'submit_for_review',
      'upsert_plan',
    ]);
    expect(toolNames).not.toContain('list_projects');

    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    expect(toolsByName.get('get_project_tree')?.annotations?.readOnlyHint).toBe(true);
    expect(toolsByName.get('get_node_context')?.annotations?.readOnlyHint).toBe(true);

    // 2. Full 6-tool lifecycle via MCP Client
    const upsertRes = await clientA.callTool({
      name: 'upsert_plan',
      arguments: {
        group_name: 'Phase 1',
        nodes: [
          {
            node_type: 'module',
            title: 'API Gateway',
            description: 'HTTP routing & validation',
            scope_files: ['server/index.ts'],
            rules: 'Follow strict project isolation.',
            children: [
              {
                node_type: 'task',
                title: 'Implement Rate Limiter',
                description: 'Add token bucket limiter',
                scope_files: ['server/middleware/rate-limit.ts'],
                checklist: ['Implement limiter', 'Add unit tests'],
              },
            ],
          },
        ],
      },
    });
    expect(upsertRes.isError).not.toBe(true);
    const upsertText = extractText(upsertRes);
    expect(upsertText).toContain('# Plan Upserted — Phase 1');
    expect(upsertText.trim().startsWith('{')).toBe(false);

    const taskIdMatch = upsertText.match(/\(task\) Implement Rate Limiter — id:([^\s]+)/);
    expect(taskIdMatch).not.toBeNull();
    const taskId = taskIdMatch![1]!;

    const treeRes = await clientA.callTool({
      name: 'get_project_tree',
      arguments: {},
    });
    expect(treeRes.isError).not.toBe(true);
    const treeText = extractText(treeRes);
    expect(treeText).toContain('# E2E Project A');
    expect(treeText).toContain('(module) API Gateway');
    expect(treeText).toContain('[planned] (task) Implement Rate Limiter');

    const startRes = await clientA.callTool({
      name: 'start_node',
      arguments: { node_id: taskId },
    });
    expect(startRes.isError).not.toBe(true);
    const startText = extractText(startRes);
    expect(startText).toContain('Status: `in_progress`');
    expect(startText).toContain('Follow strict project isolation.');
    expect(startText).toContain('server/index.ts');
    expect(getNodeById(projectA.id, taskId, testDb)?.status).toBe('in_progress');

    const revRes = await clientA.callTool({
      name: 'add_revision',
      arguments: {
        parent_node_id: taskId,
        title: 'Handle Burst Headers',
        description: 'Return Retry-After header when throttled',
      },
    });
    expect(revRes.isError).not.toBe(true);
    const revText = extractText(revRes);
    const revIdMatch = revText.match(/Revision ID: `([^`]+)`/);
    expect(revIdMatch).not.toBeNull();
    const revNode = getNodeById(projectA.id, revIdMatch![1]!, testDb);
    expect(revNode?.node_type).toBe('revision');
    expect(revNode?.parent_id).toBe(taskId);
    expect(revNode?.group_id).toBe(getNodeById(projectA.id, taskId, testDb)?.group_id);

    const reviewRes = await clientA.callTool({
      name: 'submit_for_review',
      arguments: {
        node_id: taskId,
        ai_report: 'Implemented token bucket limiter and verified edge cases.',
        checked_items: ['0', 'Add unit tests'],
      },
    });
    expect(reviewRes.isError).not.toBe(true);
    const updatedTask = getNodeById(projectA.id, taskId, testDb)!;
    expect(updatedTask.status).toBe('needs_review');
    expect(updatedTask.ai_report).toBe(
      'Implemented token bucket limiter and verified edge cases.'
    );
    expect(updatedTask.checklist).toEqual([
      { text: 'Implement limiter', checked: true },
      { text: 'Add unit tests', checked: true },
    ]);

    // Trigger REST request-revision -> verify human_feedback visible in MCP get_node_context
    const restRev = await fetch(
      `${baseUrl}/api/projects/${projectA.id}/nodes/${taskId}/request-revision`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          human_feedback: 'Handle retry backoff cleanly.',
        }),
      }
    );
    expect(restRev.status).toBe(200);

    const ctxAfterFeedback = await clientA.callTool({
      name: 'get_node_context',
      arguments: { node_id: taskId },
    });
    expect(ctxAfterFeedback.isError).not.toBe(true);
    expect(extractText(ctxAfterFeedback)).toContain(
      'Handle retry backoff cleanly.'
    );

    // Round 2: AI starts revision with revision_plan -> submits -> human_feedback cleared, timeline preserved, original plan intact
    const startRound2 = await clientA.callTool({
      name: 'start_node',
      arguments: {
        node_id: taskId,
        revision_plan: 'Add exponential backoff and cap retries at 3 attempts.',
      },
    });
    expect(startRound2.isError).not.toBe(true);
    expect(extractText(startRound2)).toContain('AI Revision Plan');

    const reviewRound2 = await clientA.callTool({
      name: 'submit_for_review',
      arguments: {
        node_id: taskId,
        ai_report: 'Added exponential backoff with max 3 retries.',
      },
    });
    expect(reviewRound2.isError).not.toBe(true);

    const round2Node = getNodeById(projectA.id, taskId, testDb)!;
    expect(round2Node.status).toBe('needs_review');
    expect(round2Node.description).toBe('Add token bucket limiter');
    expect(round2Node.human_feedback).toBe('');
    expect(round2Node.review_history.map((e) => e.type)).toEqual([
      'ai_report',
      'human_feedback',
      'ai_plan',
      'ai_report',
    ]);

    const approveRes = await fetch(
      `${baseUrl}/api/projects/${projectA.id}/nodes/${taskId}/approve`,
      { method: 'POST' }
    );
    expect(approveRes.status).toBe(200);
    const approvedNode = getNodeById(projectA.id, taskId, testDb)!;
    expect(approvedNode.status).toBe('done');
    expect(approvedNode.review_history.map((e) => e.type)).toEqual([
      'ai_report',
      'human_feedback',
      'ai_plan',
      'ai_report',
      'approved',
    ]);

    // 3. Cross-project isolation (Project A client cannot read/mutate Project B's node)
    const clientB = await connectMcpClient(projectB.id);
    const upsertB = await clientB.callTool({
      name: 'upsert_plan',
      arguments: {
        group_name: 'Beta Phase',
        nodes: [{ node_type: 'task', title: 'Beta Secret Task' }],
      },
    });
    expect(upsertB.isError).not.toBe(true);
    const betaTaskId = extractText(upsertB).match(/\(task\) Beta Secret Task — id:([^\s]+)/)![1]!;

    const crossRead = await clientA.callTool({
      name: 'get_node_context',
      arguments: { node_id: betaTaskId },
    });
    expect(crossRead.isError).toBe(true);

    const crossStart = await clientA.callTool({
      name: 'start_node',
      arguments: { node_id: betaTaskId },
    });
    expect(crossStart.isError).toBe(true);

    const crossRev = await clientA.callTool({
      name: 'add_revision',
      arguments: {
        parent_node_id: betaTaskId,
        title: 'Unauthorized revision',
        description: 'Should be rejected',
      },
    });
    expect(crossRev.isError).toBe(true);

    const crossReview = await clientA.callTool({
      name: 'submit_for_review',
      arguments: {
        node_id: betaTaskId,
        ai_report: 'Unauthorized report',
      },
    });
    expect(crossReview.isError).toBe(true);

    expect(getNodeById(projectB.id, betaTaskId, testDb)?.status).toBe('planned');

    // 4. Live SSE trigger via MCP Client upsert_plan
    const sseController = new AbortController();
    const sseRes = await fetch(
      `${baseUrl}/api/projects/${projectA.id}/events`,
      { signal: sseController.signal }
    );
    expect(sseRes.status).toBe(200);
    const sse = createSseReader(sseRes.body!);

    try {
      const connectedEvent = await sse.readEvent();
      expect(connectedEvent.event).toBe('connected');

      const liveUpsert = await clientA.callTool({
        name: 'upsert_plan',
        arguments: {
          group_name: 'Phase 2',
          nodes: [{ node_type: 'task', title: 'SSE Triggered Task' }],
        },
      });
      expect(liveUpsert.isError).not.toBe(true);

      const updatedEvent = await sse.readEvent();
      expect(updatedEvent.event).toBe('project_updated');
      expect(JSON.parse(updatedEvent.data).projectId).toBe(projectA.id);
    } finally {
      sseController.abort();
      await sse.cancel().catch(() => {});
    }

    for (let i = 0; i < 30; i++) {
      if (broadcaster.getSubscriberCount(projectA.id) === 0) {
        break;
      }
      await Bun.sleep(15);
    }
    expect(broadcaster.getSubscriberCount(projectA.id)).toBe(0);
  });
});
