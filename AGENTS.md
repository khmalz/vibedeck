# AGENTS.md

Guidance for AI coding agents and contributors working in the **VibeDeck** repository.

## Project Purpose

**VibeDeck** is a local-first **Central Command Deck** for AI-assisted coding. A single local server manages multiple isolated projects via UUIDs, pairing a **Grouped Fractal Tree** (`module` → `task` → `revision`) with an **Inspector & Two-Way Review Panel** so humans and external MCP coding agents (Claude Code, OpenCode, Antigravity) stay aligned on plans, scope, rules, and review feedback.

## Strict Runtime & Tech Stack

- **Runtime:** Bun only (`bun`, `bunx`). Do NOT use `npm`, `node`, or `better-sqlite3`.
- **Database:** Native `bun:sqlite`, initialized with `{ create: true, strict: true }`, `PRAGMA journal_mode = WAL;`, and `PRAGMA foreign_keys = ON;`.
- **Backend:** Hono + TypeScript + `@modelcontextprotocol/sdk` (Stateless Web Standard Streamable HTTP) + Zod.
- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`).
- **Realtime:** Server-Sent Events only (`streamSSE` from `hono/streaming`, Bun `idleTimeout: 0`, `stream.onAbort` cleanup). Do NOT use WebSockets.

## Architecture, Security & UX Invariants

- **Strict Project Isolation:** Every project is isolated via its UUID in `/mcp/:projectId`. Never expose `list_projects` or any cross-project MCP tool, never auto-create projects from `/mcp/:projectId` (return HTTP `404`), and always scope SQL queries by `project_id`.
- **MCP Implementation Rules:**
  - Inspect installed `node_modules/@modelcontextprotocol/sdk` exports before modifying MCP transport or tool code.
  - Instantiate a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` per request; never consume `c.req.raw` before `transport.handleRequest(c.req.raw)`.
  - Return clean, concise Markdown from all MCP tools (never raw JSON dumps), and broadcast `project_updated` via SSE after mutating transactions commit.
- **Inspector Ownership Boundaries:**
  - `ai_report` is permanently read-only (AI-owned).
  - Shared specification fields (`title`, `status`, `description` / Plan & Process, `scope_files`, `rules`, `checklist`) are read-only by default behind an explicit **Edit** toggle, with **Plan & Process** collapsed by default.
  - Human review actions (`human_feedback`, **Approve (Done)**, **Request Revision**, **Delete**) remain always active.
- **Configuration & Scope Discipline:**
  - Server `PORT` (default `3333`) and `VIBEDECK_DB_PATH` (default `~/.vibedeck/vibedeck.db`) must remain configurable via environment variables.
  - Stay within v0.1 scope—avoid Non-Goals in [docs/PRD.md](./docs/PRD.md) (no auth/cloud, no drag-and-drop reordering, no in-app LLM calls, no direct target-repo file or Git mutations).

## Development Commands

```bash
bun install             # Install dependencies
bun run dev:server      # Start Bun + Hono server with --watch (port 3333)
bun run dev:web         # Start Vite dev server (proxies /api and /mcp -> :3333)
bun run build           # Build production frontend bundle into web/dist
bun run start           # Start production single-server build
bun x tsc --noEmit      # Type-check server and frontend
bun test                # Run backend unit & MCP/SSE end-to-end tests
```

## Documentation & Skills Map

- [docs/PRD.md](./docs/PRD.md) — Product requirements, user flows, and non-goals
- [docs/SPEC.md](./docs/SPEC.md) — SQLite schema, MCP contract, REST/SSE API, and Soft Obsidian UI tokens
- [docs/TECH_NOTES.md](./docs/TECH_NOTES.md) — Verified Context7 API signatures for MCP SDK, Hono, `bun:sqlite`, and Tailwind v4
- [docs/PLAN.md](./docs/PLAN.md) — Completed v0.1 build phases and verification checklist
- `.agents/skills/` — Installed project skills (`hono`, `mcp-builder`, `frontend-design`), tracked in `skills-lock.json`
