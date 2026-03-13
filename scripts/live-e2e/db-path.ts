import { resolve } from "node:path";

export function resolveDbFilePath(): string {
  const configured = process.env.DB_FILE_PATH;
  const normalizedConfigured =
    configured === ".data/web-orchestrator.sqlite" || configured === "./.data/web-orchestrator.sqlite"
      ? "web-orchestrator.sqlite"
      : configured ?? "web-orchestrator.sqlite";

  return resolve(process.cwd(), normalizedConfigured);
}
