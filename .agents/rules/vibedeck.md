# VibeDeck — Project-Specific Rules

## Runtime & Tech Stack (Strict)
- **Runtime:** Bun only (`bun`, `bunx`). Do NOT use `npm`, `node`, or `better-sqlite3`.
- **Database:** Native `bun:sqlite`. Always enable `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;` on initialization.
- **Backend:** Hono + TypeScript + `@modelcontextprotocol/sdk` + Zod.
- **Frontend:** Vite + React + TypeScript + Tailwind CSS.
- **Realtime:** Use Server-Sent Events (SSE) only. Do NOT use WebSockets.

## Architecture & Project Isolation
- Every project is strictly isolated via its UUID in the MCP URL: `/mcp/:projectId`.
- **FORBIDDEN:** Never expose an MCP tool that lists all projects (e.g., `list_projects`) or accesses data outside the `:projectId` bound to the request URL.
- Server port and database path must be configurable via environment variables (`PORT` default `3333`, `VIBEDECK_DB_PATH` default `~/.vibedeck/vibedeck.db`) to support clean separation between dev and local production instances.

## MCP Implementation Rules
- Use **MCP Streamable HTTP** transport compatible with Web Standard `Request`/`Response` in Bun/Hono.
- Before writing MCP integration code, **inspect the installed version and actual exports** inside `node_modules/@modelcontextprotocol/sdk` to avoid hallucinated imports or outdated transport APIs.
- All MCP tool responses must return clean, concise, human- and AI-readable **Markdown**—never raw, verbose JSON dumps.

## Execution Discipline
- Read `.agents/docs/PRD.md`, `.agents/docs/SPEC.md`, and `.agents/docs/PLAN.md` before writing any code.
- Execute **one Phase at a time** according to `PLAN.md`. Stop after completing a phase's verification steps and wait for user confirmation before moving on.
- Avoid over-engineering: never implement features listed under **Non-Goals** in `PRD.md`.