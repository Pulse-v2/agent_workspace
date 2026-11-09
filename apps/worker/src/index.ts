import "./load-env.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { executeAgentJob } from "./agent/execute-run.js";
import { processDocumentJob } from "./documents/process.js";
import { getWorkerEnv } from "./env.js";
import { logger as rootLogger } from "./logger.js";
import { startHeartbeat } from "./observability/heartbeat.js";
import { WorkerMetrics } from "./observability/metrics.js";
import { getProvider } from "./providers/index.js";
import { claimAgentJobs } from "./queue/agent-runs.js";
import { claimJobs, closeQueueDatabase } from "./queue/database.js";

const env = getWorkerEnv();
const workerId = `worker-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const logger = rootLogger.child({ worker_id: workerId });
const agentProvider = getProvider("agent");

logger.info("Worker configuration validated", {
  llm_provider: agentProvider.name,
  model: agentProvider.model,
  demo_mode: env.DEMO_MODE,
  poll_interval_ms: env.WORKER_POLL_INTERVAL_MS,
  max_agent_steps: env.MAX_AGENT_STEPS,
  max_agent_retries: env.MAX_AGENT_RETRIES,
});

const metrics = new WorkerMetrics();
const heartbeat = startHeartbeat(workerId, metrics, logger);

// Aborting this signal stops polling and tells in-flight agent runs to hand their job back.
const shutdown = new AbortController();
const requestShutdown = (signal: string) => {
  if (shutdown.signal.aborted) return;
  logger.info("Shutdown requested; finishing in-flight work", { signal });
  shutdown.abort();
};
process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

async function idle() {
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: shutdown.signal }).catch(() => undefined);
}

/** Independent loops so a long agent run never blocks document indexing (and vice versa). */
async function pollLoop(name: string, tick: () => Promise<boolean>) {
  const loopLogger = logger.child({ loop: name });
  while (!shutdown.signal.aborted) {
    try {
      if (!(await tick())) await idle();
    } catch (error) {
      loopLogger.error("Poll loop iteration failed", { error });
      await idle();
    }
  }
}

try {
  await Promise.all([
    pollLoop("documents", async () => {
      const jobs = await claimJobs(workerId, 1);
      for (const job of jobs) await metrics.track(() => processDocumentJob(job, workerId, logger));
      return jobs.length > 0;
    }),
    pollLoop("agent-runs", async () => {
      const jobs = await claimAgentJobs(workerId, 1);
      for (const job of jobs) await metrics.track(() => executeAgentJob(job, workerId, shutdown.signal, logger));
      return jobs.length > 0;
    }),
  ]);
} finally {
  await heartbeat.stop();
  await closeQueueDatabase();
  logger.info("Worker stopped", metrics.snapshot());
}
