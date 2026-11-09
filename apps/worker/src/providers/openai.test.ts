import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AgentError } from "../agent/errors.js";
import { mapOpenAIError } from "./openai.js";

const headers = new Headers();

function mapped(error: unknown) {
  const result = mapOpenAIError(error);
  expect(result).toBeInstanceOf(AgentError);
  return result as AgentError;
}

describe("mapOpenAIError", () => {
  it("retries rate limits, timeouts, connection and server errors", () => {
    expect(mapped(new OpenAI.RateLimitError(429, {}, "slow down", headers))).toMatchObject({ code: "provider_rate_limited", retryable: true });
    expect(mapped(new OpenAI.APIConnectionTimeoutError())).toMatchObject({ code: "provider_timeout", retryable: true });
    expect(mapped(new OpenAI.APIConnectionError({ message: "down" }))).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(mapped(new OpenAI.InternalServerError(500, {}, "oops", headers))).toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("does not retry credential, quota, or request errors", () => {
    expect(mapped(new OpenAI.AuthenticationError(401, {}, "bad key sk-123", headers))).toMatchObject({ code: "provider_auth_failed", retryable: false });
    expect(mapped(new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "quota", headers))).toMatchObject({ code: "provider_request_rejected", retryable: false });
    expect(mapped(new OpenAI.BadRequestError(400, {}, "bad", headers))).toMatchObject({ code: "provider_request_rejected", retryable: false });
  });

  it("uses safe messages that never echo provider error text", () => {
    expect(mapped(new OpenAI.AuthenticationError(401, {}, "bad key sk-123", headers)).message).not.toContain("sk-123");
  });

  it("passes through user aborts and unknown errors unchanged", () => {
    const abort = new OpenAI.APIUserAbortError();
    expect(mapOpenAIError(abort)).toBe(abort);
    const unknown = new Error("other");
    expect(mapOpenAIError(unknown)).toBe(unknown);
  });
});
