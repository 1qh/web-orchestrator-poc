import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { db } from "./client";

let initialized = false;

export function ensureDatabaseInitialized(): void {
  if (initialized) {
    return;
  }

  const migrationsFolder = resolve(process.cwd(), "drizzle");
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      "Drizzle migrations are missing. Run `bun run db:generate` first.",
    );
  }

  migrate(db, { migrationsFolder });
  initialized = true;
}
