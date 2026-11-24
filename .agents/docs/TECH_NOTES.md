# VibeDeck — Verified Technical Notes (Context7)

Concise API signatures, imports, and minimal working snippets verified against official docs.

---

## 1. `@modelcontextprotocol/sdk` — Streamable HTTP & `McpServer`

> Note: Per `.agents/rules/vibedeck.md`, inspect the exact installed exports in `node_modules/@modelcontextprotocol/sdk` before implementing. (v1.x publishes under `@modelcontextprotocol/sdk/*`; v2 splits into `@modelcontextprotocol/server`.)

### Server Initialization with `instructions`
```ts
// v1.x: import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// v2.x: import { McpServer } from '@modelcontextprotocol/server';
const server = new McpServer(
  { name: 'vibedeck', version: '0.1.0' },
  { instructions: 'Your project-scoped workflow instructions...' }
);
```

### Registering Tools (`registerTool`)
- Signature: `server.registerTool(name, { title?, description, inputSchema, outputSchema?, annotations? }, handler)`
- Supports Zod v3 and v4 (`zod-compat` in v1.32+; v1.x accepts raw shape `{ id: z.string() }` or `z.object(...)`; v2 takes `z.object(...)`).
- Return shape: `{ content: [{ type: 'text', text: '...' }], isError?: boolean }`.

```ts
server.registerTool(
  'get_node_context',
  {
    description: 'Fetch node details and ancestor chain',
    inputSchema: { node_id: z.string() },
  },
  async ({ node_id }) => ({
    content: [{ type: 'text', text: `# Node ${node_id}` }],
  })
);
```

### Stateless Web Standard Streamable HTTP (Bun / Hono)
- `WebStandardStreamableHTTPServerTransport` accepts Web Standard `Request` and returns `Promise<Response>`.
- **Important:** With `sessionIdGenerator: undefined` (stateless), a transport serves **exactly one request** and throws if reused. Instantiate a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport` per request.

```ts
// v1.x: verify subpath in node_modules/@modelcontextprotocol/sdk (e.g. server/webStandardStreamableHttp.js)
// v2.x: import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
app.all('/mcp/:projectId', async (c) => {
  const server = createProjectMcpServer(c.req.param('projectId'));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
```

---

## 2. `hono` — `streamSSE` & Static Files in Bun

### Server-Sent Events (`streamSSE`)
- Import: `import { streamSSE } from 'hono/streaming'`
- Signature: `streamSSE(c, async (stream) => { ... }, onError?)`
- Key `SSEStreamingApi` members: `stream.writeSSE({ data, event?, id? })`, `stream.onAbort(cb)`, `stream.sleep(ms)`, `stream.close()`, `stream.aborted`.
- Do **not** wrap SSE routes with Hono's `timeout` middleware; errors inside the callback do not trigger `app.onError`.

```ts
import { streamSSE } from 'hono/streaming';

app.get('/api/projects/:projectId/events', (c) => {
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => {
      // unsubscribe client from broadcaster
    });
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ok: true }) });
    while (!stream.aborted) {
      await stream.sleep(15_000); // keepalive / wait for abort
    }
  });
});
```

### Serving Static Files in Bun (`serveStatic`)
- Preferred import: `import { serveStatic } from '@hono/bun'` (`hono/bun` has identical exports in v4, but is deprecated for removal in Hono v5).

```ts
import { serveStatic } from '@hono/bun';

app.use('/assets/*', serveStatic({ root: './web/dist' }));
app.get('*', serveStatic({ path: './web/dist/index.html' }));
```

---

## 3. `bun` — `bun:sqlite` (WAL, Prepared Statements, Transactions)

### Database Initialization & PRAGMAs
- Import: `import { Database } from 'bun:sqlite'`
- Pass `{ strict: true }` so missing/misspelled named parameters throw instead of binding `NULL`.

```ts
import { Database } from 'bun:sqlite';

const db = new Database(dbPath, { create: true, strict: true });
db.run('PRAGMA journal_mode = WAL;');
db.run('PRAGMA foreign_keys = ON;');
// Optional for faster WAL commits: db.run('PRAGMA synchronous = NORMAL;');
```

### Prepared Statements (`db.query` vs `db.prepare`)
- `db.query(sql)`: compiles and caches the `Statement` on the `Database` instance (use for static/repeated queries).
- `db.prepare(sql)`: compiles a fresh uncached `Statement` (use for dynamic SQL).
- Execution methods: `.all(params)` -> `Row[]`, `.get(params)` -> `Row | null`, `.run(params)` -> `{ changes, lastInsertRowid }`.

```ts
const getProject = db.query('SELECT * FROM projects WHERE id = $id');
const row = getProject.get({ $id: projectId });
```

### Transactions (`db.transaction`)
- `db.transaction(fn)` returns a wrapper function that auto-begins, auto-commits on return, and auto-rolls back on throw.
- **Must be synchronous** (async callbacks are not supported). Nested transactions become `SAVEPOINT`s.

```ts
const insertNode = db.prepare('INSERT INTO nodes (id, title) VALUES ($id, $title)');
const upsertMany = db.transaction((items: Array<{ $id: string; $title: string }>) => {
  for (const item of items) insertNode.run(item);
  return items.length;
});
upsertMany([{ $id: '1', $title: 'Module A' }]);
```

---

## 4. `tailwindcss` — Latest v4 + Vite + React Setup

- Install: `bun add tailwindcss @tailwindcss/vite`
- No `tailwind.config.js` or PostCSS config required.

```ts
// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

```css
/* web/src/index.css */
@import "tailwindcss";
```
