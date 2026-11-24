# PRD — VibeDeck (v0.1 MVP)

## 1. Product Summary
**VibeDeck** is a local-first web application acting as a **Central Command Deck** for vibe coding. A single local server manages multiple isolated projects via UUIDs. Each project features a **Grouped Fractal Tree** (collapsible hierarchical planning grouped by phase or status) paired with an **Inspector & Review Panel** enabling two-way verification between humans and external AI coding agents (Claude Code, Antigravity, OpenCode, and any MCP-compatible client).

## 2. Problem Statement
- Managing AI plans across scattered manual Markdown files breaks context continuity and increases AI hallucination.
- Standard Kanban boards flatten tasks into isolated cards, hiding parent-child relationships (module context, submodules, and linked revisions).
- Existing workflows lack a structured handoff and review loop between AI execution reports and human revision feedback.

## 3. Core User Flows
1. **Project Onboarding:**
   - The user clicks **+ Add Project** in the Web UI and enters a project name and short summary.
   - VibeDeck generates a unique `projectId` (UUID) and exposes a project-scoped MCP URL (`http://localhost:3333/mcp/<uuid>`).
   - The user copies or downloads a ready-to-use MCP config file tailored to their AI tool (Claude Code, OpenCode, Antigravity/Generic) and places it inside the target project workspace.
2. **Live AI Planning:**
   - Inside the target project workspace, the user prompts an AI agent to plan a feature or project.
   - The AI calls the `upsert_plan` MCP tool. VibeDeck's browser UI updates the Grouped Fractal Tree in real time via SSE without requiring a page refresh.
   - The user reviews the tree and edits descriptions, scope files, or rules directly in the UI if needed.
3. **AI Execution & Two-Way Verification:**
   - The user instructs the AI to execute a specific node. The AI calls `start_node` (receiving full node details plus inherited ancestor context) and edits project code strictly within `scope_files` and `rules`.
   - Upon completion, the AI calls `submit_for_review` with an `ai_report` and checklist updates. The node moves to `needs_review`.
   - In the Web UI, the user inspects the work and chooses:
     - **Approve (Done):** Marks the node as `done`.
     - **Request Revision:** Submits `human_feedback` and returns the node to `in_progress`, or allows the AI to attach a child `revision` node under the related module/task.

## 4. v0.1 Scope (In-Scope)
- Multi-project management with strict UUID isolation.
- Add Project modal with copy/download MCP config templates.
- Grouped Fractal Tree with expand/collapse and view toggle (**Group by Phase** vs **Group by Status**).
- Flexible recursive hierarchy (soft limit of 3 main levels: Module → Submodule → Task, plus attached `revision` child nodes).
- Right-hand Inspector & Review Panel (ancestor breadcrumb, Markdown description, scope files, rules, interactive checklist, AI report, human feedback, Approve & Request Revision actions).
- Basic inline/panel editing from the UI (edit title, description, scope files, rules, status; delete node/group).
- Real-time browser sync via SSE.
- 6 core MCP tools + built-in MCP server instructions.

## 5. Non-Goals (Out of Scope for v0.1)
- User authentication, multi-user accounts, or cloud deployment.
- Drag-and-drop tree reordering.
- Built-in AI chat or direct LLM API calls inside VibeDeck (all AI interaction happens from external MCP clients).
- Automatic Git operations or direct reading/writing of target project source files by the VibeDeck server.