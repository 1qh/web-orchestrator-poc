import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DB_FILE_PATH ?? "./web-orchestrator.sqlite",
  },
  strict: true,
  verbose: true,
});
