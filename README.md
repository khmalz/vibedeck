# VibeDeck

A local-first **Central Command Deck** for AI-assisted ("vibe") coding. VibeDeck replaces scattered Markdown plans and flat Kanban boards with a **Grouped Fractal Tree** and an **Inspector & Review Panel**—enabling structured planning, scope/rule enforcement, and two-way verification between humans and external MCP coding agents.

---

## Features

- **Strict Project Isolation:** A single local server manages multiple projects, each isolated by UUID at `/mcp/:projectId` (never exposing cross-project data).
- **Grouped Fractal Tree:** Collapsible hierarchical planning (`module` → `task` → `revision`) with **By Phase** and **By Status** (`In Progress`, `Needs Review`, `Planned`, `Done`) views.
- **Inspector & Two-Way Review:**
  - **Plan & Process:** Collapsible Markdown plan/process view (collapsed by default) for reviewing the AI's approach before execution.
  - **Read-Only by Default:** Node status, title, description, scope files, rules, and checklist stay locked behind an explicit **Edit** toggle to prevent accidental changes.
  - **Human Review Loop:** Permanent read-only **AI Report** paired with always-active **Plan & Process Feedback**, **Request Revision**, and **Approve (Done)** controls.
- **Real-Time Sync (SSE):** Browser UI updates automatically via Server-Sent Events whenever an MCP agent or REST action mutates a project.
- **One-Click MCP Onboarding:** Generate, copy, or download ready-to-use MCP configs for **Claude Code** (`.mcp.json`), **OpenCode** (`opencode.json`), and **Antigravity / Generic MCP** (`mcp_config.json`).

---

## Tech Stack

- **Runtime & Database:** [Bun](https://bun.sh) + native `bun:sqlite` (WAL mode + foreign keys)
- **Backend & MCP:** [Hono](https://hono.dev) + TypeScript + `@modelcontextprotocol/sdk` (Stateless Streamable HTTP) + Zod
- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4
- **Realtime:** Server-Sent Events (`streamSSE` / `EventSource`)

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) (`v1.4+`)

### Install Dependencies
```bash
bun install
```

### Development
Run the backend server and Vite frontend dev server in separate terminals:
```bash
# Terminal 1: API + MCP + SSE server (http://localhost:3333)
bun run dev:server

# Terminal 2: Vite React dev server (proxies /api and /mcp -> :3333)
bun run dev:web
```

### Production (Single Server)
Build the frontend bundle and serve everything from port `3333`:
```bash
bun run build
bun run start
```

### Run Tests
```bash
bun test
```

---

## Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3333` | HTTP port for the API, MCP endpoint, SSE stream, and static UI |
| `VIBEDECK_DB_PATH` | `~/.vibedeck/vibedeck.db` | SQLite database file path (parent directory is created automatically) |

---

## Connecting an AI Coding Agent

1. Open VibeDeck in your browser and click **+ Add Project**.
2. Enter a project name and summary to generate its isolated UUID endpoint (`http://localhost:3333/mcp/<PROJECT_ID>`).
3. Copy or download the generated configuration for your client (**Claude Code**, **OpenCode**, or **Antigravity / Generic MCP**) into your target project workspace.

### Built-in MCP Tools (Project-Scoped)

| Tool | Purpose |
| :--- | :--- |
| `get_project_tree` | Returns the project summary, groups, and hierarchical tree (supports `status_filter`) |
| `get_node_context` | Returns full node details plus inherited ancestor `scope_files`, `rules`, and `human_feedback` |
| `upsert_plan` | Creates or updates grouped hierarchical nodes inside a single SQLite transaction |
| `start_node` | Marks a node `in_progress` and returns its full context + ancestor rules + feedback |
| `submit_for_review` | Saves `ai_report`, updates checklist items, and moves the node to `needs_review` |
| `add_revision` | Attaches a child `revision` node under an existing parent node |

---

## Project Structure

```text
vibedeck/
├── AGENTS.md                 # Shared agent & contributor rules and architecture invariants
├── CONTRIBUTING.md           # Local setup, PR verification, and commit guidelines
├── README.md
├── .env.example              # Sample PORT and VIBEDECK_DB_PATH configuration
├── package.json
├── docs/                     # PRD, technical spec, verified tech notes, and build plan
├── .agents/skills/           # Installed agent skills (tracked in skills-lock.json)
├── server/
│   ├── index.ts              # Bun + Hono entry point (API, MCP, SSE, static UI)
│   ├── types.ts              # Shared TypeScript types & Zod schemas
│   ├── db/                   # bun:sqlite client, schema, and scoped queries
│   ├── mcp/                  # Per-project MCP server factory, 6 tools, Markdown formatter
│   ├── routes/               # REST API routes and per-project SSE broadcaster
│   └── tests/                # End-to-end MCP + SSE integration tests
└── web/
    ├── vite.config.ts        # Vite + Tailwind v4 + /api & /mcp dev proxy
    └── src/
        ├── App.tsx
        ├── api/client.ts     # REST helpers + EventSource SSE hook
        └── components/       # TopBar, AddProjectModal, FractalTree, TreeNodeItem, InspectorPanel
```

---

## Documentation & Contributing

- [AGENTS.md](./AGENTS.md) — Shared rules, runtime constraints, and architectural invariants
- [docs/PRD.md](./docs/PRD.md) — Product requirements and v0.1 scope
- [docs/SPEC.md](./docs/SPEC.md) — Database schema, MCP contract, REST/SSE API, and UI design tokens
- [docs/TECH_NOTES.md](./docs/TECH_NOTES.md) — Verified SDK and library usage notes
