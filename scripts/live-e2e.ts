import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFinalThreadState,
  createThread,
  runChatAndAssert,
  startBackgroundAndWait,
} from "./live-e2e/http-workflow";
import { startServer, stopServer, waitForServer } from "./live-e2e/server-process";

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

async function main(): Promise<void> {
  loadLocalEnvFile();
  assertApiKeyConfigured();

  const dbPath = resolve(process.cwd(), process.env.DB_FILE_PATH ?? ".data/web-orchestrator.sqlite");
  rmSync(dbPath, { force: true });

  const port = Number(process.env.E2E_PORT ?? "3411");
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port, baseUrl);

  try {
    await waitForServer(baseUrl);

    const threadId = await createThread(baseUrl);
    await runChatAndAssert(baseUrl, threadId);

    const taskId = await startBackgroundAndWait(baseUrl, threadId);
    await assertFinalThreadState(baseUrl, threadId, taskId);

    console.log("LIVE_E2E_OK");
  } finally {
    await stopServer(server);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_FAILED: ${message}`);
  process.exitCode = 1;
});
