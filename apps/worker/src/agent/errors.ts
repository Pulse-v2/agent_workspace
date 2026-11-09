import { ZodError } from "zod";

/**
 * Stable failure codes persisted to agent_runs.error_code. Messages attached to
 * AgentError are safe to show to users; raw provider/database errors are not.
 */
export const agentFailureCodes = [
  "invalid_model_output",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_timeout",
  "provider_auth_failed",
  "provider_request_rejected",
  "token_limit_exceeded",
  "cost_limit_exceeded",
  "step_limit_exceeded",
  "duration_limit_exceeded",
  "tool_failed",
  "permission_denied",
  "database_unavailable",
  "run_not_found",
  "internal_error",
] as const;
export type AgentFailureCode = (typeof agentFailureCodes)[number];

export class AgentError extends Error {
  constructor(
    readonly code: AgentFailureCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentError";
  }
}

export type AgentFailure = { code: AgentFailureCode; message: string; retryable: boolean };

// Connection-level failures from postgres.js / Node sockets, and Postgres
// serialization/deadlock/shutdown SQLSTATEs that are safe to retry.
const transientDatabaseCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "CONNECT_TIMEOUT", "CONNECTION_CLOSED",
  "CONNECTION_ENDED", "CONNECTION_DESTROYED", "40001", "40P01", "57P01", "57P02", "57P03", "53300",
]);

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    return typeof code === "string" ? code : null;
  }
  return null;
}

export function classifyError(error: unknown): AgentFailure {
  if (error instanceof AgentError) return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof ZodError) {
    return { code: "invalid_model_output", message: "The model returned a result that failed validation.", retryable: true };
  }
  const code = errorCode(error);
  if (code && (transientDatabaseCodes.has(code) || code.startsWith("08"))) {
    return { code: "database_unavailable", message: "The database was temporarily unavailable.", retryable: true };
  }
  return { code: "internal_error", message: "The run failed because of an unexpected internal error.", retryable: true };
}

/**
 * attempts is the job attempt that just failed (1-based, incremented on claim).
 * A run gets at most maxRetries retries after the first attempt, bounded by the
 * job's own max_attempts.
 */
export function shouldRetry(failure: AgentFailure, attempts: number, maxAttempts: number, maxRetries: number) {
  return failure.retryable && attempts <= maxRetries && attempts < maxAttempts;
}

/** Exponential backoff in seconds: 15s, 30s, 60s ... capped at 15 minutes. */
export function retryDelaySeconds(attempts: number) {
  return Math.min(900, 2 ** Math.max(0, attempts) * 15 / 2);
}
