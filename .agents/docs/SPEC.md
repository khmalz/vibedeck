# Technical Specification — VibeDeck v0.1

## 1. Repository Structure
```text
vibedeck/
├── package.json              # Root scripts (dev:server, dev:web, build, start)
├── .agents/                  # Agent rules, skills, and documentation
├── server/
│   ├── index.ts              # Bun + Hono entry point (API, MCP, SSE, static UI)
│   ├── db/
│   │   ├── client.ts         # bun:sqlite initialization (WAL, FK ON, auto-mkdir)
│   │   ├── schema.ts         # Idempotent schema creation (CREATE TABLE IF NOT EXISTS)
│   │   └── queries.ts        # CRUD for projects, groups, nodes + ancestor chain lookup
│   ├── mcp/
│   │   ├── server.ts         # Per-project MCP server factory + built-in instructions
│   │   ├── tools.ts          # Implementation of the 6 core MCP tools
│   │   └── formatter.ts      # Token-efficient Markdown response formatters
│   ├── routes/
│   │   ├── api.ts            # REST API endpoints for the Web UI
│   │   └── sse.ts            # Per-project SSE event broadcaster
│   └── types.ts              # Shared TypeScript types & Zod validation schemas
└── web/                      # Vite + React + TypeScript + Tailwind CSS
    ├── index.html
    ├── vite.config.ts        # Dev proxy for /api and /mcp -> http://localhost:3333
    └── src/
        ├── App.tsx
        ├── api/client.ts     # Fetch helpers + EventSource SSE hook
        ├── components/
        │   ├── TopBar.tsx            # Project switcher, + Add Project, SSE indicator
        │   ├── AddProjectModal.tsx   # Project creation + Copy/Download MCP config tabs
        │   ├── FractalTree.tsx       # Collapsible grouped tree + Phase/Status toggle
        │   ├── TreeNodeItem.tsx      # Recursive node row with type & status badges
        │   └── InspectorPanel.tsx    # Node details, editor, checklist, AI report, review controls
        └── types.ts
```

## 2. SQLite Schema (`bun:sqlite`)
Default path: `~/.vibedeck/vibedeck.db` (auto-create parent directory if missing). Initialize with `new Database(dbPath, { create: true, strict: true })` and run `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`.

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('module', 'task', 'revision')),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'needs_review', 'done')),
  scope_files TEXT NOT NULL DEFAULT '[]',   -- JSON array of file paths: ["src/a.ts"]
  rules TEXT DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '[]',     -- JSON array: [{"text":"...","checked":false}]
  ai_report TEXT DEFAULT '',
  human_feedback TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
```

## 3. MCP Contract (`/mcp/:projectId`)

### Project Validation
If `:projectId` does not exist in `projects`, return HTTP `404` with a clear JSON error message. Never auto-create projects from the MCP endpoint.

### Transport & Isolation Rules
- Mount `app.all('/mcp/:projectId', ...)` without prior JSON body-parsing middleware so `c.req.raw` remains unconsumed for `transport.handleRequest(c.req.raw)`.
- Use stateless per-request instantiation: create a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` per request (never reuse a stateless transport across requests).
- Scope every SQL query by `project_id = $projectId` (never look up or mutate by `node_id` alone).
- Include MCP tool `annotations` (`readOnlyHint: true` on `get_project_tree` and `get_node_context`).
- Execute `upsert_plan` inside a synchronous `db.transaction(...)`, then trigger the SSE broadcast after commit.

### Built-in Server Instructions
Pass these instructions during MCP Server initialization:
> "You are connected to VibeDeck for a single isolated project. Follow this workflow strictly: (1) Call `get_project_tree` at the start of a session to understand the current plan and status. (2) When planning new features, call `upsert_plan` using a clean hierarchy (soft limit: max 3 levels: module -> submodule -> task). (3) Before modifying code, call `start_node` and strictly obey `scope_files` and `rules` from both the target node and all ancestor nodes. (4) When asked to fix or revise existing work, call `add_revision` attached to the relevant parent node. (5) Upon completing a node, always call `submit_for_review` with a concise summary of changes and updated checklist items."

### Core MCP Tools (6 Total)
Every mutating tool MUST trigger an SSE broadcast (`project_updated`) to connected web clients viewing that `projectId`.

1. **`get_project_tree`**
   - Input: `{ status_filter?: 'planned' | 'in_progress' | 'needs_review' | 'done' }`
   - Output (Markdown): Project name and summary, followed by each Group and an indented tree listing `[status] (node_type) Title — id:<node_id>`.
2. **`get_node_context`**
   - Input: `{ node_id: string }`
   - Output (Markdown): Full details of the target node **plus its complete Ancestor Chain** (root down to target) including inherited `title`, `description`, `scope_files`, and `rules`, along with `checklist`, `ai_report`, and `human_feedback`.
3. **`upsert_plan`**
   - Input:
     ```ts
     {
       group_name: string,
       nodes: Array<{
         id?: string, // update if existing in this project; insert otherwise
         node_type: 'module' | 'task' | 'revision',
         title: string,
         description?: string,
         scope_files?: string[],
         rules?: string,
         checklist?: string[], // normalized to { text, checked: false }
         children?: /* recursive array of the same node shape */
       }>
     }
     ```
   - Behavior: Find or create `group_name` within the project, then recursively insert/update nodes inside a single SQLite transaction. Soft limit: append a gentle warning in the Markdown output if non-revision nesting exceeds 3 levels.
   - Output (Markdown): Summary of created/updated nodes and their IDs.
4. **`start_node`**
   - Input: `{ node_id: string }`
   - Behavior: Set `status = 'in_progress'`, update `updated_at`, broadcast SSE.
   - Output (Markdown): Identical to `get_node_context` (full node + ancestor context + any `human_feedback`).
5. **`submit_for_review`**
   - Input:
     ```ts
     {
       node_id: string,
       ai_report: string,
       checked_items?: string[] // checklist item texts or 0-based indices to mark checked
     }
     ```
   - Behavior: Set `status = 'needs_review'`, save `ai_report`, update `checklist`, broadcast SSE.
   - Output (Markdown): Confirmation that the node is now `needs_review` and awaiting human verification.
6. **`add_revision`**
   - Input:
     ```ts
     {
       parent_node_id: string,
       title: string,
       description: string,
       scope_files?: string[],
       rules?: string,
       checklist?: string[]
     }
     ```
   - Behavior: Create a `revision` node with `parent_id = parent_node_id`, inheriting `group_id` from the parent, initial status `planned`, broadcast SSE.
   - Output (Markdown): Confirmation with the new revision node ID and parent reference.

## 4. REST API & SSE (Web UI)
- `GET /api/health` — Health check (`{ ok: true }`).
- `GET /api/projects` — List all projects.
- `POST /api/projects` — Create a project (UUID via `crypto.randomUUID()`).
- `DELETE /api/projects/:projectId` — Delete a project and cascade all groups/nodes.
- `GET /api/projects/:projectId/tree` — Return `{ project, groups, nodes }` for rendering the tree.
- `POST /api/projects/:projectId/groups` — Manually create a group.
- `DELETE /api/projects/:projectId/groups/:groupId` — Delete a group (nodes remain with `group_id = NULL`), broadcast SSE.
- `PATCH /api/projects/:projectId/nodes/:nodeId` — Update node fields (`title`, `description`, `status`, `scope_files`, `rules`, `checklist`, `human_feedback`).
- `POST /api/projects/:projectId/nodes/:nodeId/approve` — Shortcut to set `status = 'done'`.
- `POST /api/projects/:projectId/nodes/:nodeId/request-revision` — Save `human_feedback` and set `status = 'in_progress'`.
- `DELETE /api/projects/:projectId/nodes/:nodeId` — Delete a node (cascades to children).
- `GET /api/projects/:projectId/events` — **SSE** endpoint (`text/event-stream`) using Hono `streamSSE` (`hono/streaming`). Emits `connected` on open and `project_updated` on any MCP or REST mutation for that project. Configure the Bun server with `idleTimeout: 0` plus a periodic heartbeat, unsubscribe the client in `stream.onAbort`, and do not wrap this route with Hono `timeout` middleware.

All mutating REST routes (`POST`/`PATCH`/`DELETE` on groups and nodes) MUST broadcast `project_updated` to SSE subscribers for that `projectId`.

## 5. MCP Config Download Templates (Add Project Modal)
Display the raw MCP URL `http://localhost:<PORT>/mcp/<PROJECT_ID>` plus Copy and Download buttons across 3 tabs:

- **Claude Code** (filename: `.mcp.json`):
  ```json
  {
    "mcpServers": {
      "vibedeck": {
        "type": "http",
        "url": "http://localhost:3333/mcp/<PROJECT_ID>"
      }
    }
  }
  ```
- **OpenCode** (filename: `opencode.json`):
  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
      "vibedeck": {
        "type": "remote",
        "url": "http://localhost:3333/mcp/<PROJECT_ID>",
        "enabled": true
      }
    }
  }
  ```
- **Antigravity / Generic MCP** (filename: `mcp_config.json`):
  ```json
  {
    "mcpServers": {
      "vibedeck": {
        "serverUrl": "http://localhost:3333/mcp/<PROJECT_ID>"
      }
    }
  }
  ```

## 6. UI Layout & Color Palette (Soft Obsidian)
- **Layout:** Fixed TopBar (`52px` height) + 2-column main workspace (Left 55%: Grouped Fractal Tree, Right 45%: Inspector & Review Panel).
- **Fractal Tree Grouping Modes:**
  - `By Phase (Group)`: Collapsible containers per database group, rendering nested collapsible parent-child trees inside.
  - `By Status`: 4 collapsible status containers (`In Progress` expanded, `Needs Review` expanded, `Planned` expanded, `Done` collapsed by default), showing a subtle parent/group breadcrumb tag on each item so context stays clear.
- **Color Tokens:**
  - App Background: `#111318`
  - Surface / Panel / Card: `#181B22`
  - Surface Hover / Elevated: `#1F242E`
  - Borders & Tree Connector Lines: `#272B36`
  - Text Primary / Secondary: `#E6E8EE` / `#8B92A5`
  - Status `in_progress`: `#6384FF` (Soft Indigo)
  - Status `needs_review`: `#E5A93C` (Warm Amber)
  - Status `done`: `#3ECF8E` (Muted Emerald)
  - Status `planned`: `#6E768A` (Muted Slate)
  - Badge `revision`: `#E06C75` (Soft Coral)