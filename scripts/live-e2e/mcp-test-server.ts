import { randomUUID } from "node:crypto";
import { type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type RunningMcpTestServer = {
  url: string;
  stop: () => Promise<void>;
};

type ExpressLikeRequest = IncomingMessage & {
  body?: unknown;
};

type ExpressLikeResponse = ServerResponse & {
  status: (code: number) => ExpressLikeResponse;
  json: (body: unknown) => void;
  send: (body: string) => void;
};

function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "web-orchestrator-live-mcp-test",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  server.registerTool(
    "health_check",
    {
      description: "Deterministic MCP health probe for live e2e verification.",
      inputSchema: {
        echo: z.string().optional(),
      },
    },
    async ({ echo }) => {
      return {
        content: [
          {
            type: "text",
            text: `MCP_TEST_OK${echo ? ` ${echo}` : ""}`,
          },
        ],
        structuredContent: {
          ok: true,
          echo: echo ?? null,
        },
      };
    },
  );

  return server;
}

export async function startMcpTestServer(port: number): Promise<RunningMcpTestServer> {
  const app = createMcpExpressApp();

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Set<McpServer>();

  app.post("/mcp", async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (typeof sessionId === "string" && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            transports.set(initializedSessionId, transport!);
          },
        });

        transport.onclose = () => {
          const current = transport?.sessionId;
          if (current) {
            transports.delete(current);
          }
        };

        const server = buildServer();
        servers.add(server);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      if (!transport) {
        throw new Error("MCP transport was not initialized");
      }

      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string") {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string") {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transport.handleRequest(req, res);
  });

  const server = await new Promise<HttpServer>((resolve, reject) => {
    const started = app.listen(port, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(started);
    });
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    stop: async () => {
      for (const transport of transports.values()) {
        await transport.close();
      }
      transports.clear();

      for (const mcpServer of servers.values()) {
        await mcpServer.close();
      }
      servers.clear();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
