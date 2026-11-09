import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentError, classifyError, retryDelaySeconds, shouldRetry } from "./errors.js";

describe("classifyError", () => {
  it("keeps the code, safe message, and retry policy of AgentError", () => {
    const failure = classifyError(new AgentError("cost_limit_exceeded", "Budget reached.", false));
    expect(failure).toEqual({ code: "cost_limit_exceeded", message: "Budget reached.", retryable: false });
  });

  it("treats schema validation errors as retryable invalid model output", () => {
    const result = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(result.success).toBe(false);
    expect(classifyError(result.error)).toMatchObject({ code: "invalid_model_output", retryable: true });
  });

  it("treats connection and serialization failures as transient database errors", () => {
    expect(classifyError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })).code).toBe("database_unavailable");
    expect(classifyError(Object.assign(new Error("deadlock"), { code: "40P01" })).retryable).toBe(true);
    expect(classifyError(Object.assign(new Error("conn"), { code: "08006" })).code).toBe("database_unavailable");
  });

  it("never exposes raw messages of unknown errors", () => {
    const failure = classifyError(new Error("password=hunter2 at internal.ts:12"));
    expect(failure.code).toBe("internal_error");
    expect(failure.message).not.toContain("hunter2");
  });
});

describe("retry policy", () => {
  const transient = { code: "provider_timeout", message: "timeout", retryable: true } as const;
  const permanent = { code: "provider_auth_failed", message: "auth", retryable: false } as const;

  it("allows MAX_AGENT_RETRIES retries after the first attempt", () => {
    expect(shouldRetry(transient, 1, 5, 3)).toBe(true);
    expect(shouldRetry(transient, 3, 5, 3)).toBe(true);
    expect(shouldRetry(transient, 4, 5, 3)).toBe(false);
  });

  it("is bounded by the job's max_attempts", () => {
    expect(shouldRetry(transient, 2, 2, 10)).toBe(false);
  });

  it("never retries permanent failures", () => {
    expect(shouldRetry(permanent, 1, 5, 3)).toBe(false);
  });

  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3].map(retryDelaySeconds)).toEqual([15, 30, 60]);
    expect(retryDelaySeconds(20)).toBe(900);
  });
});
