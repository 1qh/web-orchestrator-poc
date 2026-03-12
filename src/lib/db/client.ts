import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

const configuredPath = process.env.DB_FILE_PATH ?? ".data/web-orchestrator.sqlite";

const normalizedPath = configuredPath.startsWith("/")
  ? configuredPath
  : resolve(process.cwd(), configuredPath);

mkdirSync(dirname(normalizedPath), { recursive: true });

const sqlite = new Database(normalizedPath, {
  create: true,
  strict: true,
});

sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA busy_timeout = 5000;");

export const db = drizzle(sqlite, { schema });
export { sqlite };
export const dbFilePath = normalizedPath;
