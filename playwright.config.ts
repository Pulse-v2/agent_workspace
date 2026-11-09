import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the built web app, a real worker, and the local
 * Supabase stack. Prerequisites: `pnpm db:start` and `pnpm build`.
 * The worker is started in global setup (it has no HTTP port to wait on).
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `pnpm --filter @ai-agent/web exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    // Never reuse: a stale server from an older build serves mismatched chunks.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
