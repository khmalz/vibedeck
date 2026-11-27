import type { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { db } from '../db/client';
import {
  appendHistoryEntry,
  approveNodeById,
  createGroup,
  createProject,
  deleteGroup,
  deleteNode,
  deleteProject,
  exportProjectBundle,
  getNodeById,
  getProjectById,
  getProjectTree,
  importProjectBundle,
  listProjects,
  reopenNodeById,
  requestRevisionOnNode,
  syncPatchedHumanFeedback,
  updateNode,
} from '../db/queries';
import {
  ApproveNodeSchema,
  CreateGroupSchema,
  CreateProjectSchema,
  PatchNodeSchema,
  ProjectExportBundleSchema,
  ReopenNodeSchema,
  RequestRevisionSchema,
} from '../types';
import { sseBroadcaster, type SseBroadcaster } from './sse';

type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

async function parseJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>
): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON request body.' }, 400),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        { error: 'Validation failed.', details: parsed.error.issues },
        400
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/** Build the project-scoped REST API Hono sub-router (mounted under /api). */
export function createApiRoutes(
  database: Database = db,
  broadcaster: SseBroadcaster = sseBroadcaster
): Hono {
  const routes = new Hono();

  routes.get('/projects', (c) => {
    return c.json({ projects: listProjects(database) });
  });

  routes.post('/projects', async (c) => {
    const parsed = await parseJsonBody(c, CreateProjectSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const project = createProject(parsed.data, database);
    return c.json({ project }, 201);
  });

  routes.post('/projects/import', async (c) => {
    const parsed = await parseJsonBody(c, ProjectExportBundleSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const result = importProjectBundle(parsed.data, database);
    return c.json(result, 201);
  });

  routes.get('/projects/:projectId/export', (c) => {
    const projectId = c.req.param('projectId');
    const bundle = exportProjectBundle(projectId, database);
    if (!bundle) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }
    const slug =
      bundle.project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'project';
    c.header(
      'Content-Disposition',
      `attachment; filename="vibedeck-${slug}.json"`
    );
    return c.json(bundle);
  });

  routes.delete('/projects/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    const deleted = deleteProject(projectId, database);
    if (!deleted) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }
    broadcaster.disconnectProject(projectId);
    return c.json({ ok: true });
  });

  routes.get('/projects/:projectId/tree', (c) => {
    const projectId = c.req.param('projectId');
    const tree = getProjectTree(projectId, database);
    if (!tree) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }
    return c.json(tree);
  });

  routes.post('/projects/:projectId/groups', async (c) => {
    const projectId = c.req.param('projectId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    const parsed = await parseJsonBody(c, CreateGroupSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const group = createGroup(projectId, parsed.data, database);
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ group }, 201);
  });

  routes.delete('/projects/:projectId/groups/:groupId', (c) => {
    const projectId = c.req.param('projectId');
    const groupId = c.req.param('groupId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    const deleted = deleteGroup(projectId, groupId, database);
    if (!deleted) {
      return c.json(
        { error: `Group "${groupId}" not found in project "${projectId}".` },
        404
      );
    }
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ ok: true });
  });

  routes.patch('/projects/:projectId/nodes/:nodeId', async (c) => {
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    const parsed = await parseJsonBody(c, PatchNodeSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const existing = getNodeById(projectId, nodeId, database);
    if (!existing) {
      return c.json(
        { error: `Node "${nodeId}" not found in project "${projectId}".` },
        404
      );
    }

    const isTransitioningToDone =
      existing.status !== 'done' && parsed.data.status === 'done';

    const baseHistory =
      parsed.data.human_feedback !== undefined
        ? syncPatchedHumanFeedback(
            existing.review_history,
            parsed.data.human_feedback
          )
        : existing.review_history;

    const shouldAppendApproved =
      isTransitioningToDone &&
      (parsed.data.human_feedback === undefined ||
        parsed.data.human_feedback.trim() === '');

    const nextHistory = shouldAppendApproved
      ? appendHistoryEntry(baseHistory, 'approved', 'Approved (Done)')
      : baseHistory;

    const patchPayload = {
      ...parsed.data,
      ...(isTransitioningToDone && parsed.data.human_feedback === undefined
        ? { human_feedback: '' }
        : {}),
      ...(nextHistory !== existing.review_history
        ? { review_history: nextHistory }
        : {}),
    };

    const node = updateNode(projectId, nodeId, patchPayload, database);
    if (!node) {
      return c.json(
        { error: `Node "${nodeId}" not found in project "${projectId}".` },
        404
      );
    }
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ node });
  });

  routes.post('/projects/:projectId/nodes/:nodeId/approve', async (c) => {
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    let comment: string | undefined;
    const rawBody = await c.req.text();
    if (rawBody.trim().length > 0) {
      let jsonBody: unknown;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'Invalid JSON request body.' }, 400);
      }
      const parsed = ApproveNodeSchema.safeParse(jsonBody);
      if (!parsed.success) {
        return c.json(
          { error: 'Validation failed.', details: parsed.error.issues },
          400
        );
      }
      comment = parsed.data.comment;
    }

    const node = approveNodeById(projectId, nodeId, comment, database);
    if (!node) {
      return c.json(
        { error: `Node "${nodeId}" not found in project "${projectId}".` },
        404
      );
    }
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ node });
  });

  routes.post('/projects/:projectId/nodes/:nodeId/reopen', async (c) => {
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    let body: { reason?: string; cascade_scope?: 'cascaded' | 'all' } = {};
    const rawBody = await c.req.text();
    if (rawBody.trim().length > 0) {
      let jsonBody: unknown;
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'Invalid JSON request body.' }, 400);
      }
      const parsed = ReopenNodeSchema.safeParse(jsonBody);
      if (!parsed.success) {
        return c.json(
          { error: 'Validation failed.', details: parsed.error.issues },
          400
        );
      }
      body = parsed.data;
    }

    const result = reopenNodeById(projectId, nodeId, body, database);
    if (!result.ok) {
      return c.json({ error: result.error }, result.code === 'not_found' ? 404 : 400);
    }

    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ node: result.node, reopened_count: result.reopenedCount });
  });

  routes.post('/projects/:projectId/nodes/:nodeId/request-revision', async (c) => {
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    const parsed = await parseJsonBody(c, RequestRevisionSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const node = requestRevisionOnNode(
      projectId,
      nodeId,
      parsed.data.human_feedback,
      database
    );
    if (!node) {
      return c.json(
        { error: `Node "${nodeId}" not found in project "${projectId}".` },
        404
      );
    }
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ node });
  });

  routes.delete('/projects/:projectId/nodes/:nodeId', (c) => {
    const projectId = c.req.param('projectId');
    const nodeId = c.req.param('nodeId');
    if (!getProjectById(projectId, database)) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    const deleted = deleteNode(projectId, nodeId, database);
    if (!deleted) {
      return c.json(
        { error: `Node "${nodeId}" not found in project "${projectId}".` },
        404
      );
    }
    broadcaster.broadcast(projectId, 'project_updated');
    return c.json({ ok: true });
  });

  return routes;
}
