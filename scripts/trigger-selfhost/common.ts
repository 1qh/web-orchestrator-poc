import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SELFHOST_WEBAPP_URL = "http://127.0.0.1:18030";

const LOCAL_TRIGGER_DIR = resolve(process.cwd());
const LOCAL_TRIGGER_COMPOSE_FILE = resolve(LOCAL_TRIGGER_DIR, "trigger-v4.compose.yml");
const LOCAL_TRIGGER_ENV_TEMPLATE = resolve(LOCAL_TRIGGER_DIR, "trigger-v4.env.example");
const RUNTIME_TRIGGER_ENV_FILE = resolve(process.cwd(), "trigger-v4.env");

function runOrThrow(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status ?? 1})${
        stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ""
      }`,
    );
  }

  return (result.stdout ?? "").trim();
}

export function ensureDockerComposeAvailable(): void {
  runOrThrow("docker", ["compose", "version"]);
}

export function ensureTriggerRepoCloned(): void {
  if (!existsSync(LOCAL_TRIGGER_COMPOSE_FILE)) {
    throw new Error(`Missing Trigger compose file: ${LOCAL_TRIGGER_COMPOSE_FILE}`);
  }
}

export function ensureTriggerEnvFile(): void {
  ensureTriggerRepoCloned();

  if (existsSync(RUNTIME_TRIGGER_ENV_FILE)) {
    return;
  }

  copyFileSync(LOCAL_TRIGGER_ENV_TEMPLATE, RUNTIME_TRIGGER_ENV_FILE);
}

function setEnvValue(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${value}`);
  }

  const withNewline = content.endsWith("\n") ? content : `${content}\n`;
  return `${withNewline}${key}=${value}\n`;
}

export function ensureLocalSelfHostEnvOverrides(): void {
  ensureTriggerEnvFile();

  let content = readFileSync(RUNTIME_TRIGGER_ENV_FILE, "utf8");

  content = setEnvValue(content, "APP_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "LOGIN_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "API_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "DEV_OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:18030/otel");
  content = setEnvValue(content, "CLICKHOUSE_URL", "http://default:password@clickhouse:8123?secure=false");
  content = setEnvValue(content, "QUERY_CLICKHOUSE_URL", "http://default:password@clickhouse:8123");
  content = setEnvValue(content, "RUN_REPLICATION_CLICKHOUSE_URL", "http://default:password@clickhouse:8123");
  content = setEnvValue(content, "RUN_REPLICATION_ENABLED", "0");

  writeFileSync(RUNTIME_TRIGGER_ENV_FILE, content, "utf8");
}

export function ensureLocalSelfHostPortOverrides(): void {
  ensureTriggerRepoCloned();
}

export function compose(args: string[]): string {
  ensureTriggerEnvFile();

  return runOrThrow(
    "docker",
    [
      "compose",
      "--env-file",
      RUNTIME_TRIGGER_ENV_FILE,
      "-f",
      "trigger-v4.compose.yml",
      ...args,
    ],
    LOCAL_TRIGGER_DIR,
  );
}

export async function waitForWebappReady(baseUrl: string): Promise<void> {
  for (let attempts = 0; attempts < 120; attempts += 1) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch (error) {
      void error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Trigger webapp did not become ready: ${baseUrl}`);
}
