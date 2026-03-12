import { spawnSync } from "node:child_process";

function loadLocalEnvFile(): void {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  loadEnvFile?.(".env.local");
}

function assertApiKeyConfigured(): void {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY) {
    return;
  }

  throw new Error(
    "Missing Google API key. Set GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_VERTEX_API_KEY in .env.local.",
  );
}

function runBunScript(scriptName: string, extraArgs: string[] = [], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync("bun", ["run", scriptName, ...extraArgs], {
    cwd: process.cwd(),
    env: env ?? { ...process.env },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`bun run ${scriptName} failed (exit ${result.status ?? 1})`);
  }
}

function runBunScriptCapture(
  scriptName: string,
  extraArgs: string[] = [],
  env?: NodeJS.ProcessEnv,
): string {
  const result = spawnSync("bun", ["run", scriptName, ...extraArgs], {
    cwd: process.cwd(),
    env: env ?? { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `bun run ${scriptName} failed (exit ${result.status ?? 1})${stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ""}`,
    );
  }

  return (result.stdout ?? "").trim();
}

function parseBootstrapExports(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("export ")) {
      continue;
    }

    const declaration = trimmed.slice("export ".length);
    const splitIndex = declaration.indexOf("=");
    if (splitIndex <= 0) {
      continue;
    }

    const key = declaration.slice(0, splitIndex).trim();
    const value = declaration.slice(splitIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    values[key] = value;
  }

  return values;
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  assertApiKeyConfigured();

  runBunScript("trigger:selfhost:reset");
  runBunScript("trigger:selfhost:start");
  runBunScript("trigger:selfhost:status");

  const bootstrapOutput = runBunScriptCapture("trigger:selfhost:bootstrap", ["--exports-only"]);
  const bootstrapEnv = parseBootstrapExports(bootstrapOutput);

  const requiredKeys = [
    "USE_TRIGGER_DEV",
    "TRIGGER_API_URL",
    "TRIGGER_PROJECT_REF",
    "TRIGGER_SECRET_KEY",
    "TRIGGER_ACCESS_TOKEN",
    "BACKGROUND_CALLBACK_SECRET",
  ] as const;

  for (const key of requiredKeys) {
    if (!bootstrapEnv[key]) {
      throw new Error(`Bootstrap did not return required export: ${key}`);
    }
  }

  const liveEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...bootstrapEnv,
    E2E_REQUIRE_TRIGGER: "true",
  };

  runBunScript("typecheck", [], liveEnv);
  runBunScript("test:e2e", [], liveEnv);
  runBunScript("test:e2e:live:full", [], liveEnv);
  runBunScript("test:e2e:live:trigger", [], liveEnv);
  runBunScript("build", [], liveEnv);

  console.log("LIVE_E2E_PROOF_OK");
}

void main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`LIVE_E2E_PROOF_FAILED: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    spawnSync("bun", ["run", "trigger:selfhost:stop"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: "inherit",
    });
  });
