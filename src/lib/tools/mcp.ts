// Reference notes from oh-my-openagent:
// - src/features/skill-mcp-manager/http-client.ts
// - src/mcp/index.ts
import { mcpManager } from "@/lib/mcp/manager";

export async function runMcpTool(args: {
  serverName: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
}): Promise<{
  serverName: string;
  toolName: string;
  result: unknown;
}> {
  const result = await mcpManager.callTool(args);
  return {
    serverName: args.serverName,
    toolName: args.toolName,
    result,
  };
}

export async function listMcpServerTools(serverName: string): Promise<{
  serverName: string;
  tools: Array<{ name: string; description?: string }>;
}> {
  return {
    serverName,
    tools: await mcpManager.listTools(serverName),
  };
}

export function listMcpServers(): Array<{ name: string; url: string }> {
  return mcpManager.listServers().map((server) => ({
    name: server.name,
    url: server.url,
  }));
}
