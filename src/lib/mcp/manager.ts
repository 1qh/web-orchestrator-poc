// Reference notes from oh-my-openagent:
// - src/features/skill-mcp-manager/http-client.ts
// - src/mcp/index.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { MCP_SERVERS } from "@/lib/config";

type ServerConfig = {
  name: string;
  url: string;
  headers?: Record<string, string>;
};

type ManagedClient = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  updatedAt: number;
};

class McpManager {
  private readonly clients = new Map<string, ManagedClient>();

  listServers(): ServerConfig[] {
    return MCP_SERVERS;
  }

  private getServer(name: string): ServerConfig {
    const match = MCP_SERVERS.find((server) => server.name === name);
    if (!match) {
      throw new Error(`Unknown MCP server: ${name}`);
    }

    return match;
  }

  private async getClient(name: string): Promise<ManagedClient> {
    const existing = this.clients.get(name);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }

    const config = this.getServer(name);
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });

    const client = new Client(
      {
        name: "web-orchestrator-mcp-client",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );

    await client.connect(transport);

    const managed: ManagedClient = {
      client,
      transport,
      updatedAt: Date.now(),
    };

    this.clients.set(name, managed);
    return managed;
  }

  async listTools(serverName: string): Promise<Array<{ name: string; description?: string }>> {
    const managed = await this.getClient(serverName);
    const response = await managed.client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  async callTool(args: {
    serverName: string;
    toolName: string;
    toolArgs?: Record<string, unknown>;
  }): Promise<unknown> {
    const managed = await this.getClient(args.serverName);
    const result = await managed.client.callTool({
      name: args.toolName,
      arguments: args.toolArgs,
    });

    return result;
  }

  async closeAll(): Promise<void> {
    for (const managed of this.clients.values()) {
      await managed.transport.close();
    }
    this.clients.clear();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __webOrchestratorMcpManager: McpManager | undefined;
}

if (!globalThis.__webOrchestratorMcpManager) {
  globalThis.__webOrchestratorMcpManager = new McpManager();
}

export const mcpManager = globalThis.__webOrchestratorMcpManager;
