import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  assertFinalThreadState,
  createThread,
  runChatAndAssert,
  startBackgroundAndWait,
} from "./live-e2e/http-workflow";
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
    throw new Error("Compaction verification failed");
  }

  if (payload.checks.usageTotalTokens <= 0) {
    throw new Error("Usage verification did not accumulate tokens");
  }

  const requireMcp = process.env.E2E_REQUIRE_MCP === "true";
  if (requireMcp && payload.checks.mcpServerCount <= 0) {
    throw new Error("E2E_REQUIRE_MCP=true but no MCP server is configured in MCP_SERVERS_JSON.");
  }

  if (payload.checks.mcpConnectivityChecked && !payload.checks.mcpConnectivityOk) {
    throw new Error("MCP server is configured but connectivity verification failed.");
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

  const dbPath = resolve(process.cwd(), process.env.DB_FILE_PATH ?? ".data/web-orchestrator.sqlite");
  rmSync(dbPath, { force: true });

  const port = Number(process.env.E2E_PORT ?? "3421");
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startProductionServer(port, baseUrl);

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
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_FULL_FAILED: ${message}`);
  process.exitCode = 1;
});
