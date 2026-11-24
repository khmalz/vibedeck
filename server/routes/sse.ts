import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/client';
import { getProjectById } from '../db/queries';

export interface SseSubscriber {
  send: (event: string, data: string) => Promise<void>;
  close: () => void;
}

export interface SseBroadcaster {
  subscribe: (projectId: string, subscriber: SseSubscriber) => () => void;
  broadcast: (
    projectId: string,
    event?: string,
    payload?: Record<string, unknown>
  ) => void;
  disconnectProject: (projectId: string) => void;
  getSubscriberCount: (projectId?: string) => number;
}

/** Create an isolated per-project SSE subscriber registry and broadcaster. */
export function createSseBroadcaster(): SseBroadcaster {
  const subscribers = new Map<string, Set<SseSubscriber>>();

  const subscribe = (projectId: string, subscriber: SseSubscriber): (() => void) => {
    let set = subscribers.get(projectId);
    if (!set) {
      set = new Set();
      subscribers.set(projectId, set);
    }
    set.add(subscriber);

    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      const current = subscribers.get(projectId);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        subscribers.delete(projectId);
      }
    };
  };

  const broadcastEvent = (
    projectId: string,
    event = 'project_updated',
    payload: Record<string, unknown> = {}
  ): void => {
    const set = subscribers.get(projectId);
    if (!set || set.size === 0) {
      return;
    }

    const data = JSON.stringify({ projectId, ts: Date.now(), ...payload });
    for (const subscriber of Array.from(set)) {
      void subscriber.send(event, data).catch(() => {
        set.delete(subscriber);
        if (set.size === 0) {
          subscribers.delete(projectId);
        }
        subscriber.close();
      });
    }
  };

  const disconnectProject = (projectId: string): void => {
    const set = subscribers.get(projectId);
    if (!set) {
      return;
    }
    const snapshot = Array.from(set);
    subscribers.delete(projectId);
    for (const subscriber of snapshot) {
      subscriber.close();
    }
  };

  const getSubscriberCount = (projectId?: string): number => {
    if (projectId !== undefined) {
      return subscribers.get(projectId)?.size ?? 0;
    }
    let total = 0;
    for (const set of subscribers.values()) {
      total += set.size;
    }
    return total;
  };

  return {
    subscribe,
    broadcast: broadcastEvent,
    disconnectProject,
    getSubscriberCount,
  };
}

export const sseBroadcaster = createSseBroadcaster();

/** Broadcast a project_updated SSE event to all subscribers of projectId. */
export function broadcast(
  projectId: string,
  payload: Record<string, unknown> = {}
): void {
  sseBroadcaster.broadcast(projectId, 'project_updated', payload);
}

/** Build the SSE Hono sub-router (mounted under /api). */
export function createSseRoutes(
  database: Database = db,
  broadcaster: SseBroadcaster = sseBroadcaster,
  options: { heartbeatMs?: number } = {}
): Hono {
  const routes = new Hono();
  const heartbeatMs = options.heartbeatMs ?? 15_000;

  routes.get('/projects/:projectId/events', (c) => {
    const projectId = c.req.param('projectId');
    const project = getProjectById(projectId, database);
    if (!project) {
      return c.json({ error: `Project "${projectId}" not found.` }, 404);
    }

    return streamSSE(c, async (stream) => {
      let cleanedUp = false;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = () => {};

      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        unsubscribe();
        resolveDone();
      };

      stream.onAbort(() => {
        cleanup();
      });

      unsubscribe = broadcaster.subscribe(projectId, {
        send: async (event, data) => {
          if (stream.aborted || stream.closed || cleanedUp) {
            return;
          }
          await stream.writeSSE({ event, data });
        },
        close: () => {
          cleanup();
          if (!stream.closed) {
            void stream.close().catch(() => {});
          }
        },
      });

      heartbeat = setInterval(() => {
        if (stream.aborted || stream.closed || cleanedUp) {
          cleanup();
          return;
        }
        void stream
          .writeSSE({
            event: 'heartbeat',
            data: JSON.stringify({ ts: Date.now() }),
          })
          .catch(() => {
            cleanup();
          });
      }, heartbeatMs);

      try {
        await stream.writeSSE({
          event: 'connected',
          data: JSON.stringify({ ok: true, projectId }),
        });
        await done;
      } finally {
        cleanup();
      }
    });
  });

  return routes;
}
