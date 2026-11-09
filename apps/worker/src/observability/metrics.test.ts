import { describe, expect, it } from "vitest";
import { WorkerMetrics } from "./metrics.js";

describe("WorkerMetrics", () => {
  it("tracks active, processed, failed jobs and outcomes", async () => {
    const metrics = new WorkerMetrics();
    let release!: () => void;
    const pending = metrics.track(() => new Promise<"completed">((resolve) => { release = () => resolve("completed"); }));
    expect(metrics.activeJobs).toBe(1);
    release();
    await pending;
    await metrics.track(async () => "retrying" as const);
    await metrics.track(async () => "document_failed" as const);
    await expect(metrics.track(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(metrics.snapshot()).toEqual({
      active_jobs: 0, processed_jobs: 4, failed_jobs: 3,
      outcomes: { completed: 1, retrying: 1, document_failed: 1, failed: 1 },
    });
  });
});
