/** Outcome of one claimed agent job, used for logs and worker counters. */
export type AgentJobOutcome =
  | "completed" | "paused_for_approval" | "retrying" | "failed" | "cancelled" | "released" | "lease_lost" | "skipped";

const FAILED_OUTCOMES = new Set<AgentJobOutcome>(["failed", "retrying"]);

/** In-memory counters for this worker process, reported through heartbeats. */
export class WorkerMetrics {
  activeJobs = 0;
  processedJobs = 0;
  failedJobs = 0;
  readonly outcomes = new Map<string, number>();

  async track<T extends string>(run: () => Promise<T>): Promise<T> {
    this.activeJobs += 1;
    try {
      const outcome = await run();
      this.record(outcome);
      return outcome;
    } catch (error) {
      this.record("failed");
      throw error;
    } finally {
      this.activeJobs -= 1;
    }
  }

  record(outcome: string) {
    this.processedJobs += 1;
    if (FAILED_OUTCOMES.has(outcome as AgentJobOutcome) || outcome === "document_failed") this.failedJobs += 1;
    this.outcomes.set(outcome, (this.outcomes.get(outcome) ?? 0) + 1);
  }

  snapshot() {
    return {
      active_jobs: this.activeJobs,
      processed_jobs: this.processedJobs,
      failed_jobs: this.failedJobs,
      outcomes: Object.fromEntries(this.outcomes),
    };
  }
}
