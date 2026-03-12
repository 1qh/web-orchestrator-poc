import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { createThread } from "./live-e2e/http-workflow";
import { sleep, startServer, stopServer, waitForServer } from "./live-e2e/server-process";

function loadLocalEnvFile(): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  loadEnvFile?.(".env.local");
}

function assertTriggerEnvConfigured(): void {
  if (!process.env.TRIGGER_SECRET_KEY || !process.env.TRIGGER_PROJECT_REF) {
    throw new Error(
      "Missing TRIGGER_SECRET_KEY or TRIGGER_PROJECT_REF in .env.local for real Trigger.dev verification.",
    );
  }
}

async function waitForTriggerCompletion(baseUrl: string, taskId: string): Promise<void> {
  for (let attempts = 0; attempts < 240; attempts += 1) {
    const response = await fetch(`${baseUrl}/api/background/${taskId}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Background poll failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      task: { status: "pending" | "running" | "completed" | "failed" | "cancelled"; errorText: string | null };
    };

    if (payload.task.status === "completed") {
      return;
    }

    if (payload.task.status === "failed" || payload.task.status === "cancelled") {
      throw new Error(`Trigger task ended unexpectedly: ${payload.task.errorText ?? payload.task.status}`);
    }

    await sleep(1000);
  }

  throw new Error(`Trigger task timed out: ${taskId}`);
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  assertTriggerEnvConfigured();

  const dbPath = resolve(process.cwd(), process.env.DB_FILE_PATH ?? ".data/web-orchestrator.sqlite");
  rmSync(dbPath, { force: true });

  const port = Number(process.env.E2E_TRIGGER_PORT ?? "3431");
  const baseUrl = `http://127.0.0.1:${port}`;
  const callbackSecret = `trigger-live-${randomUUID()}`;

  const triggerDev = spawn("bunx", ["trigger.dev@latest", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdio: "pipe",
  });

  const server = startServer(port, baseUrl, {
    USE_TRIGGER_DEV: "true",
    APP_BASE_URL: baseUrl,
    BACKGROUND_CALLBACK_SECRET: callbackSecret,
  });

  try {
    await waitForServer(baseUrl);
    await sleep(6000);

    const threadId = await createThread(baseUrl);

    const startResponse = await fetch(`${baseUrl}/api/background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId,
        agent: "researcher",
        prompt: "Reply with TRIGGER_REAL_OK only.",
        title: "real trigger verification",
      }),
    });

    if (!startResponse.ok) {
      throw new Error(`Failed to start trigger background task: ${startResponse.status}`);
    }

    const started = (await startResponse.json()) as {
      task: { taskId: string; transport: "local" | "trigger" };
    };

    if (started.task.transport !== "trigger") {
      throw new Error(`Expected trigger transport, got ${started.task.transport}`);
    }

    await waitForTriggerCompletion(baseUrl, started.task.taskId);
    console.log("LIVE_E2E_TRIGGER_OK");
  } finally {
    await stopServer(server);
    triggerDev.kill("SIGTERM");
    await sleep(800);
    if (!triggerDev.killed) {
      triggerDev.kill("SIGKILL");
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_TRIGGER_FAILED: ${message}`);
  process.exitCode = 1;
});
