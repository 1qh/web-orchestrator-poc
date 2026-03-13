import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  assertFinalThreadState,
  createThread,
  runChatAndAssert,
  startBackgroundAndWait,
} from "./live-e2e/http-workflow";
import { resolveDbFilePath } from "./live-e2e/db-path";
import { startMcpTestServer } from "./live-e2e/mcp-test-server";
import { assertChatRemainsUsableWhileBackgroundRuns } from "./live-e2e/non-blocking-workflow";
import { startProductionServer, stopServer, waitForServer } from "./live-e2e/server-process";

async function runInternalCapabilityVerification(baseUrl: string, threadId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/internal/live-capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId }),
  });

  if (!response.ok) {
    throw new Error(`Internal capability verification route failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    checks: {
      searchSummaryLength: number;
      syncDelegationLength: number;
      parallelSyncCount: number;
      parallelBackgroundCount: number;
      todoCreated: boolean;
      compactionTriggered: boolean;
      compactionSummaryLength: number;
      usageTotalTokens: number;
      mcpServerCount: number;
      mcpConnectivityChecked: boolean;
      mcpConnectivityOk: boolean;
      mcpToolCount: number;
      mcpToolCallAttempted: boolean;
      mcpToolCallOk: boolean;
      reasoningPartVisible: boolean;
      toolPartVisible: boolean;
      unfinishedReminderVisible: boolean;
      backgroundDoneReminderVisible: boolean;
    };
  };

  if (payload.checks.searchSummaryLength <= 0) {
    throw new Error("Search verification did not return summary text");
  }

  if (payload.checks.syncDelegationLength <= 0) {
    throw new Error("Sync delegation verification returned empty output");
  }

  if (payload.checks.parallelSyncCount !== 2 || payload.checks.parallelBackgroundCount !== 2) {
    throw new Error("Parallel delegation verification did not run both tasks");
  }

  if (!payload.checks.todoCreated) {
    throw new Error("Todo verification did not create todo item");
  }

  if (!payload.checks.compactionTriggered || payload.checks.compactionSummaryLength <= 0) {
    throw new Error(
      `Compaction verification failed (triggered=${String(payload.checks.compactionTriggered)}, summaryLength=${payload.checks.compactionSummaryLength})`,
    );
  }

  if (payload.checks.usageTotalTokens <= 0) {
    throw new Error("Usage verification did not accumulate tokens");
  }

  if (payload.checks.mcpServerCount <= 0) {
    throw new Error("MCP verification failed: no MCP server configured.");
  }

  if (!payload.checks.mcpConnectivityChecked || !payload.checks.mcpConnectivityOk) {
    throw new Error("MCP server is configured but connectivity verification failed.");
  }

  if (payload.checks.mcpToolCount <= 0) {
    throw new Error("MCP verification failed: server reported no tools.");
  }

  if (!payload.checks.mcpToolCallAttempted || !payload.checks.mcpToolCallOk) {
    throw new Error("MCP verification failed: deterministic MCP tool call did not succeed.");
  }

  if (!payload.checks.reasoningPartVisible || !payload.checks.toolPartVisible) {
    throw new Error("Visibility verification failed: reasoning/tool-call parts were not present in persisted messages.");
  }

  if (!payload.checks.unfinishedReminderVisible || !payload.checks.backgroundDoneReminderVisible) {
    throw new Error("Reminder verification failed: unfinished/background reminder messages were not visible.");
  }
}

function loadLocalEnvFile(): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  loadEnvFile?.(".env.local");
}

function assertApiKeyConfigured(): void {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY) {
    return;
  }

  throw new Error(
    "Missing Google API key. Set GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_VERTEX_API_KEY.",
  );
}

function ensureProductionBuild(): void {
  const built = spawnSync("bun", ["run", "build"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "inherit",
  });

  if (built.status !== 0) {
    throw new Error(`Production build failed before live full verification (exit ${built.status ?? 1})`);
  }
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  assertApiKeyConfigured();
  ensureProductionBuild();

  const mcpPort = Number(process.env.E2E_MCP_PORT ?? "3591");
  const mcpServer = await startMcpTestServer(mcpPort);
  const mcpServersJson = JSON.stringify([
    {
      name: "local-live-e2e-mcp",
      url: mcpServer.url,
    },
  ]);

  const dbPath = resolveDbFilePath();
  rmSync(dbPath, { force: true });

  const port = Number(process.env.E2E_PORT ?? "3421");
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startProductionServer(port, baseUrl, {
    USE_TRIGGER_DEV: "false",
    MCP_SERVERS_JSON: mcpServersJson,
    E2E_MCP_TOOL_NAME: "health_check",
    CONTEXT_TOKEN_BUDGET: "4000",
    CONTEXT_COMPACTION_TRIGGER_RATIO: "0.5",
    UNFINISHED_TODO_REMINDER_MINUTES: "0",
  });

  try {
    await waitForServer(baseUrl);

    const threadId = await createThread(baseUrl);
    await runChatAndAssert(baseUrl, threadId);
    await assertChatRemainsUsableWhileBackgroundRuns(baseUrl, threadId);

    const taskId = await startBackgroundAndWait(baseUrl, threadId);
    await assertFinalThreadState(baseUrl, threadId, taskId);

    await runInternalCapabilityVerification(baseUrl, threadId);

    console.log("LIVE_E2E_FULL_OK");
  } finally {
    await stopServer(server);
    await mcpServer.stop();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_FULL_FAILED: ${message}`);
  process.exitCode = 1;
});
