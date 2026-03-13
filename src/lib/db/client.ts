import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const rawConfiguredPath = process.env.DB_FILE_PATH;
const configuredPath =
  rawConfiguredPath === ".data/web-orchestrator.sqlite" ||
  rawConfiguredPath === "./.data/web-orchestrator.sqlite"
    ? "web-orchestrator.sqlite"
    : rawConfiguredPath ?? "web-orchestrator.sqlite";

const normalizedPath = configuredPath.startsWith("/")
  ? configuredPath
  : resolve(process.cwd(), configuredPath);

mkdirSync(dirname(normalizedPath), { recursive: true });

const sqlite = new Database(normalizedPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });
export { sqlite };
export const dbFilePath = normalizedPath;
