import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration-tests/**/*.e2e.ts"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
