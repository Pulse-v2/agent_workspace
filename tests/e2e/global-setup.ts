import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Starts the background worker for the duration of the e2e run. Returns the
 * teardown function Playwright calls at the end.
 */
export default async function globalSetup() {
  if (process.env.E2E_EXTERNAL_WORKER) return undefined;
  const worker: ChildProcess = spawn("pnpm", ["--filter", "@ai-agent/worker", "start"], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WORKER_POLL_INTERVAL_MS: "500" },
  });
  let output = "";
  worker.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  worker.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 60 && !output.includes("Worker configuration validated"); attempt += 1) await sleep(500);
  if (!output.includes("Worker configuration validated")) {
    worker.kill();
    throw new Error(`Worker did not start:\n${output.slice(-2000)}`);
  }
  return async () => {
    if (process.platform === "win32" && worker.pid) {
      // Wait for taskkill so no worker outlives the test run.
      await new Promise((resolve) => spawn("taskkill", ["/pid", String(worker.pid), "/T", "/F"], { shell: true }).on("exit", resolve));
    } else {
      worker.kill("SIGTERM");
    }
  };
}
