# Build Plan — VibeDeck v0.1

## Phase 1: Project Bootstrap & Database Layer
**Goal:** Initialize the Bun + Hono + Vite React workspace and verify the SQLite data layer.
- [ ] Set up root `package.json` with scripts (`dev:server`, `dev:web`, `build`, `start`).
- [ ] Implement `server/db/client.ts`, `server/db/schema.ts`, and `server/db/queries.ts` using `Database(..., { create: true, strict: true })` (including recursive `getNodeWithAncestors`).
- [ ] Boot the Hono server on `PORT` (default `3333`) with `idleTimeout: 0` (for SSE compatibility) and `GET /api/health`.
- **Verification:** Start the server, confirm the SQLite file is auto-created with WAL & foreign keys enabled, and verify `GET /api/health` returns `200 OK`.

## Phase 2: MCP Streamable HTTP Server (6 Tools)
**Goal:** Deliver a working `/mcp/:projectId` endpoint tested against real MCP requests.
- [ ] Inspect the installed `@modelcontextprotocol/sdk` exports for Streamable HTTP transport compatibility with Bun/Hono, use stateless per-request `McpServer` + `WebStandardStreamableHTTPServerTransport` instantiation, and verify `upsert_plan`'s recursive `children` JSON Schema output.
- [ ] Implement `server/mcp/formatter.ts`, `server/mcp/tools.ts`, and `server/mcp/server.ts` with built-in instructions.
- [ ] Mount `/mcp/:projectId` on Hono with strict project UUID validation (`404` on unknown IDs).
- **Verification:** Seed a test project, connect via an MCP client or test script, and verify `upsert_plan`, `get_project_tree`, `get_node_context`, `start_node`, `add_revision`, and `submit_for_review` return clean Markdown and persist accurately in SQLite; also verify `404` on unknown `:projectId` and rejection of cross-project `node_id` access.

## Phase 3: REST API & SSE Live Broadcaster
**Goal:** Complete backend endpoints and real-time event streaming for the Web UI.
- [ ] Implement all REST routes in `server/routes/api.ts`.
- [ ] Implement `server/routes/sse.ts` using `streamSSE` from `hono/streaming` (with `stream.onAbort` cleanup and periodic heartbeat) and hook `broadcast(projectId)` into every mutating MCP tool and REST endpoint.
- **Verification:** Open `curl -N http://localhost:3333/api/projects/<id>/events`, trigger a mutation via MCP or REST, and confirm `project_updated` streams immediately.

## Phase 4: Web UI — Layout, Project Onboarding & Fractal Tree
**Goal:** Build the left workspace and live-synced project onboarding experience.
- [ ] Configure Vite + React + Tailwind CSS v4 (`@tailwindcss/vite` + `@import "tailwindcss";`) with the Soft Obsidian color tokens (`#111318` / `#181B22`).
- [ ] Build `TopBar.tsx` (Project switcher, SSE connection status dot, `+ Add Project` button).
- [ ] Build `AddProjectModal.tsx` (create project + Copy/Download tabs for Claude Code, OpenCode, and Antigravity/Generic).
- [ ] Build `FractalTree.tsx` and `TreeNodeItem.tsx` (recursive expand/collapse, subtle connector lines, `By Phase` / `By Status` toggle, type and status badges).
- **Verification:** Create a project in the UI, trigger `upsert_plan` via MCP, and confirm the tree renders live in the browser without refresh.

## Phase 5: Web UI — Inspector, Review Loop & Single-Server Build
**Goal:** Complete the two-way verification workflow and production bundling.
- [ ] Build `InspectorPanel.tsx`: ancestor breadcrumb, editable Markdown description, scope files, rules, interactive checklist, AI report display, `human_feedback` input, **Approve (Done)** and **Request Revision** buttons, plus delete node action.
- [ ] Configure Hono to serve `web/dist` static assets in production via `serveStatic` from `@hono/bun` (with SPA fallback to `web/dist/index.html`) on a single port (`3333`).
- **Verification (End-to-End):** Run a full loop: Create project → Connect AI → AI `upsert_plan` → AI `start_node` → AI `submit_for_review` → Human `Request Revision` → AI reads feedback & resubmits → Human `Approve`.