import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SELFHOST_ROOT = resolve(process.cwd(), ".data/trigger-selfhost");
export const TRIGGER_REPO_DIR = resolve(SELFHOST_ROOT, "trigger.dev");
export const TRIGGER_DOCKER_DIR = resolve(TRIGGER_REPO_DIR, "hosting/docker");
export const SELFHOST_WEBAPP_URL = "http://127.0.0.1:18030";

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
  if (existsSync(TRIGGER_REPO_DIR)) {
    return;
  }

  mkdirSync(dirname(TRIGGER_REPO_DIR), { recursive: true });
  runOrThrow("git", ["clone", "--depth=1", "https://github.com/triggerdotdev/trigger.dev", TRIGGER_REPO_DIR]);
}

export function ensureTriggerEnvFile(): void {
  const envFile = resolve(TRIGGER_DOCKER_DIR, ".env");
  const envExample = resolve(TRIGGER_DOCKER_DIR, ".env.example");
  if (existsSync(envFile)) {
    return;
  }

  runOrThrow("cp", [envExample, envFile]);
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
  const envFile = resolve(TRIGGER_DOCKER_DIR, ".env");
  let content = readFileSync(envFile, "utf8");

  content = setEnvValue(content, "APP_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "LOGIN_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "API_ORIGIN", "http://localhost:18030");
  content = setEnvValue(content, "DEV_OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:18030/otel");
  content = setEnvValue(content, "CLICKHOUSE_URL", "http://default:password@clickhouse:8123?secure=false");
  content = setEnvValue(content, "QUERY_CLICKHOUSE_URL", "http://default:password@clickhouse:8123");
  content = setEnvValue(content, "RUN_REPLICATION_CLICKHOUSE_URL", "http://default:password@clickhouse:8123");
  content = setEnvValue(content, "RUN_REPLICATION_ENABLED", "0");

  writeFileSync(envFile, content, "utf8");
}

export function ensureLocalSelfHostPortOverrides(): void {
  const composeFile = resolve(TRIGGER_DOCKER_DIR, "webapp/docker-compose.yml");
  let content = readFileSync(composeFile, "utf8");

  const replacements: Array<[string, string]> = [
    [":8030:3000", ":18030:3000"],
    [":5433:5432", ":15433:5432"],
    [":6389:6379", ":16389:6379"],
    [":9123:8123", ":19123:8123"],
    [":9090:9000", ":19090:9000"],
    [":5000:5000", ":15000:5000"],
    [":9000:9000", ":19000:9000"],
    [":9001:9001", ":19001:9001"],
  ];

  for (const [from, to] of replacements) {
    content = content.replace(from, to);
  }

  if (!content.includes("QUERY_CLICKHOUSE_URL:")) {
    content = content.replace(
      "      CLICKHOUSE_URL: ${CLICKHOUSE_URL:-http://default:password@clickhouse:8123?secure=false}",
      [
        "      CLICKHOUSE_URL: ${CLICKHOUSE_URL:-http://default:password@clickhouse:8123?secure=false}",
        "      QUERY_CLICKHOUSE_URL: ${QUERY_CLICKHOUSE_URL:-http://default:password@clickhouse:8123}",
      ].join("\n"),
    );
  }

  writeFileSync(composeFile, content, "utf8");
}

export function compose(args: string[]): string {
  return runOrThrow(
    "docker",
    [
      "compose",
      "-f",
      "webapp/docker-compose.yml",
      "-f",
      "worker/docker-compose.yml",
      ...args,
    ],
    TRIGGER_DOCKER_DIR,
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
