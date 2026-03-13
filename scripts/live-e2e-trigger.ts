import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { resolveDbFilePath } from "./live-e2e/db-path";
import { createThread } from "./live-e2e/http-workflow";
import { sleep, startServer, stopServer, waitForServer } from "./live-e2e/server-process";

function loadLocalEnvFile(): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  loadEnvFile?.(".env.local");
}

function triggerEnvConfigured(): boolean {
  return Boolean(
    process.env.TRIGGER_PROJECT_REF && (process.env.TRIGGER_SECRET_KEY || process.env.TRIGGER_ACCESS_TOKEN),
  );
}

function triggerCliAuthConfigured(): boolean {
  return Boolean(process.env.TRIGGER_ACCESS_TOKEN);
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

function attachProcessLogs(processRef: ReturnType<typeof spawn>): { getText: () => string } {
  const chunks: string[] = [];
  const append = (chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    if (chunks.join("").length > 32_000) {
      const joined = chunks.join("");
      chunks.length = 0;
      chunks.push(joined.slice(-24_000));
    }
  };

  processRef.stdout?.on("data", append);
  processRef.stderr?.on("data", append);

  return {
    getText: () => chunks.join(""),
  };
}

async function waitForTriggerDevReady(
  processRef: ReturnType<typeof spawn>,
  getLogs: () => string,
): Promise<void> {
  for (let attempts = 0; attempts < 180; attempts += 1) {
    const logs = getLogs();
    if (logs.includes("Local worker ready")) {
      return;
    }

    if (processRef.exitCode !== null) {
      throw new Error(`trigger.dev dev exited early (code ${processRef.exitCode}): ${logs.slice(-2000)}`);
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for trigger.dev dev readiness: ${getLogs().slice(-2000)}`);
}

async function main(): Promise<void> {
  loadLocalEnvFile();

  const requireTrigger = process.env.E2E_REQUIRE_TRIGGER === "true";
  if (!triggerEnvConfigured()) {
    if (requireTrigger) {
        throw new Error(
          "E2E_REQUIRE_TRIGGER=true but TRIGGER_PROJECT_REF and one of TRIGGER_SECRET_KEY/TRIGGER_ACCESS_TOKEN are missing in .env.local.",
        );
      }

    console.log("LIVE_E2E_TRIGGER_SKIPPED");
    return;
  }

  if (requireTrigger && !triggerCliAuthConfigured()) {
    throw new Error(
      "E2E_REQUIRE_TRIGGER=true but TRIGGER_ACCESS_TOKEN is missing. This test launches `trigger.dev dev` non-interactively.",
    );
  }

  const dbPath = resolveDbFilePath();
  rmSync(dbPath, { force: true });

  const port = Number(process.env.E2E_TRIGGER_PORT ?? "3431");
  const baseUrl = `http://127.0.0.1:${port}`;
  const callbackSecret = `trigger-live-${randomUUID()}`;
  const triggerCliHome = mkdtempSync(resolve(tmpdir(), "trigger-cli-e2e-"));

  const triggerDev = spawn("bunx", ["trigger.dev@latest", "dev", "--skip-update-check"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: triggerCliHome,
      XDG_CONFIG_HOME: triggerCliHome,
      XDG_DATA_HOME: resolve(triggerCliHome, "data"),
      XDG_CACHE_HOME: resolve(triggerCliHome, "cache"),
      TRIGGER_TELEMETRY_DISABLED: "1",
    },
    stdio: "pipe",
  });
  const triggerDevLogs = attachProcessLogs(triggerDev);

  const server = startServer(port, baseUrl, {
    USE_TRIGGER_DEV: "true",
    APP_BASE_URL: baseUrl,
    BACKGROUND_CALLBACK_SECRET: callbackSecret,
  });

  try {
    await waitForServer(baseUrl);
    await waitForTriggerDevReady(triggerDev, triggerDevLogs.getText);

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
    rmSync(triggerCliHome, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LIVE_E2E_TRIGGER_FAILED: ${message}`);
  process.exitCode = 1;
});
