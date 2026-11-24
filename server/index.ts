import type { Database } from 'bun:sqlite';
import { serveStatic } from '@hono/bun';
import { Hono } from 'hono';
import { db, dbPath } from './db/client';
import { getProjectById } from './db/queries';
import { handleMcpRequest } from './mcp/server';
import { createApiRoutes } from './routes/api';
import {
  createSseRoutes,
  sseBroadcaster,
  type SseBroadcaster,
} from './routes/sse';

// Ensure database connection, pragmas, and schema are initialized at startup.
void db;

/** Build the Hono application wired to the provided SQLite database and SSE broadcaster. */
export function createApp(
  database: Database = db,
  broadcaster: SseBroadcaster = sseBroadcaster
): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api', createApiRoutes(database, broadcaster));
  app.route('/api', createSseRoutes(database, broadcaster));

  app.all('/mcp/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const project = getProjectById(projectId, database);
    if (!project) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }
    return handleMcpRequest(projectId, c.req.raw, {
      db: database,
      onMutate: (pid) => broadcaster.broadcast(pid, 'project_updated'),
    });
  });

  const isReservedPath = (url: string) => {
    const pathname = new URL(url).pathname;
    return (
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      pathname === '/mcp' ||
      pathname.startsWith('/mcp/')
    );
  };

  const staticRoot = serveStatic({ root: './web/dist' });
  const spaFallback = serveStatic({ path: './web/dist/index.html' });

  app.use('/assets/*', staticRoot);
  app.get('*', async (c, next) => {
    if (isReservedPath(c.req.url)) {
      return next();
    }
    return staticRoot(c, next);
  });
  app.get('*', async (c, next) => {
    if (isReservedPath(c.req.url)) {
      return next();
    }
    return spaFallback(c, next);
  });

  return app;
}

export const app = createApp();

const port = Number(process.env.PORT) || 3333;

if (import.meta.main) {
  console.log(`[vibedeck] server listening on http://localhost:${port} (db: ${dbPath})`);
}

export default {
  port,
  idleTimeout: 0,
  fetch: app.fetch,
};
