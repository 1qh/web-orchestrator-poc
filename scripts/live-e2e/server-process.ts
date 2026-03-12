import { spawn } from "node:child_process";

export type StartedServer = {
  kill: (signal?: NodeJS.Signals) => boolean;
  killed: boolean;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
};

type EnvOverrides = Record<string, string | undefined>;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export function startServer(port: number, baseUrl: string, envOverrides?: EnvOverrides): StartedServer {
  return spawn("bun", ["run", "dev", "--", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      USE_TRIGGER_DEV: "false",
      APP_BASE_URL: baseUrl,
      ...envOverrides,
    },
    stdio: "pipe",
  });
}

export function startProductionServer(
  port: number,
  baseUrl: string,
  envOverrides?: EnvOverrides,
): StartedServer {
  return spawn("bun", ["run", "start", "--", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      USE_TRIGGER_DEV: "false",
      APP_BASE_URL: baseUrl,
      ...envOverrides,
    },
    stdio: "pipe",
  });
}

export async function waitForServer(baseUrl: string): Promise<void> {
  for (let attempts = 0; attempts < 240; attempts++) {
    try {
      const response = await fetch(`${baseUrl}/api/threads`, {
        cache: "no-store",
      });
      if (response.ok) {
        return;
      }
    } catch (error) {
      void error;
    }

    await sleep(500);
  }

  throw new Error("Next.js server did not become ready in time");
}

export async function stopServer(server: StartedServer): Promise<void> {
  server.kill("SIGTERM");
  await sleep(800);

  if (!server.killed) {
    server.kill("SIGKILL");
  }
}
