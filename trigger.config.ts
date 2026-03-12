import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "web-orchestrator-poc",
  maxDuration: 300,
  dirs: ["src/trigger"],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 500,
      maxTimeoutInMs: 30_000,
      randomize: true,
    },
  },
});
