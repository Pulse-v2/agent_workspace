import { getDatabase } from "../queue/database.js";
import type { Logger } from "../logger.js";
import type { WorkerMetrics } from "./metrics.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const WORKER_VERSION = process.env.npm_package_version ?? "dev";

async function writeHeartbeat(workerId: string, metrics: WorkerMetrics, status: "running" | "stopping") {
  const snapshot = metrics.snapshot();
  const sql = getDatabase();
  await sql`
    insert into private.worker_heartbeats (worker_id, status, last_seen_at, active_jobs, processed_jobs, failed_jobs, version)
    values (${workerId}, ${status}, now(), ${snapshot.active_jobs}, ${snapshot.processed_jobs}, ${snapshot.failed_jobs}, ${WORKER_VERSION})
    on conflict (worker_id) do update set status = excluded.status, last_seen_at = now(),
      active_jobs = excluded.active_jobs, processed_jobs = excluded.processed_jobs, failed_jobs = excluded.failed_jobs
  `;
  // Rows of workers that stopped without cleanup are pruned after a day.
  await sql`delete from private.worker_heartbeats where last_seen_at < now() - interval '1 day'`;
}

/**
 * Publishes worker liveness and counters every 15 seconds. The web app shows
 * only aggregated liveness (workers online, last heartbeat) via queue_status().
 */
export function startHeartbeat(workerId: string, metrics: WorkerMetrics, logger: Logger) {
  let lastLoggedAt = 0;
  const beat = async (status: "running" | "stopping") => {
    try {
      await writeHeartbeat(workerId, metrics, status);
      // A compact metrics line every 5 minutes for log-based monitoring.
      if (Date.now() - lastLoggedAt > 300_000) {
        lastLoggedAt = Date.now();
        logger.info("Worker metrics", metrics.snapshot());
      }
    } catch (error) {
      logger.warn("Worker heartbeat failed", { error });
    }
  };
  void beat("running");
  const timer = setInterval(() => void beat("running"), HEARTBEAT_INTERVAL_MS);
  return {
    async stop() {
      clearInterval(timer);
      await beat("stopping");
      try {
        await getDatabase()`delete from private.worker_heartbeats where worker_id = ${workerId}`;
      } catch (error) {
        logger.warn("Worker heartbeat cleanup failed", { error });
      }
    },
  };
}
