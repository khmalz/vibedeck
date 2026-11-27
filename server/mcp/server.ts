import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerProjectTools, type McpToolOptions } from './tools';

export const VIBEDECK_MCP_INSTRUCTIONS =
  'You are connected to VibeDeck for a single isolated project. Follow this workflow strictly: (1) Call `get_project_tree` at the start of a session to understand the current plan and status. (2) When planning new features, call `upsert_plan` using a clean hierarchy (soft limit: max 3 levels: module -> submodule -> task) and write the goal and step-by-step implementation process in each node\'s `description`. (3) Before modifying code, call `start_node` and strictly obey `scope_files`, `rules`, and any `human_feedback` from both the target node and all ancestor nodes; when addressing `human_feedback` on a revision cycle, pass `revision_plan` to `start_node` rather than overwriting the original `description`. (4) When asked to fix or revise existing work, call `add_revision` attached to the relevant parent node. (5) Upon completing a node, always call `submit_for_review` with a concise summary of changes and updated checklist items. (6) If a previously `done` node was reverted, check its `Reopened` timeline entry: treat a human undo with no `human_feedback` according to its restored status, and treat one with `human_feedback` as a revision request.';

/** Create a fresh McpServer scoped to a single projectId. */
export function createProjectMcpServer(
  projectId: string,
  options?: McpToolOptions
): McpServer {
  const server = new McpServer(
    { name: 'vibedeck', version: '0.1.3' },
    { instructions: VIBEDECK_MCP_INSTRUCTIONS }
  );
  registerProjectTools(server, projectId, options);
  return server;
}

/** Handle a stateless Web Standard Streamable HTTP MCP request for a validated projectId. */
export async function handleMcpRequest(
  projectId: string,
  request: Request,
  options?: McpToolOptions
): Promise<Response> {
  const server = createProjectMcpServer(projectId, options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
