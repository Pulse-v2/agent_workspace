import { defineConfig } from "vitest/config";

/** Integration tests need the local Supabase stack (`pnpm db:start`) and no running worker. */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["src/test/integration-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
