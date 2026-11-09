import { describe, expect, it } from "vitest";
import { estimateCostUsd, estimateTokens, exceedsBudget, maxRequestCostUsd } from "./limits.js";

const pricing = { inputPerMillion: 0.15, outputPerMillion: 0.6 };

describe("cost estimation", () => {
  it("prices input and output tokens per million", () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, pricing)).toBeCloseTo(0.15);
    expect(estimateCostUsd({ inputTokens: 2000, outputTokens: 500 }, pricing)).toBeCloseTo(0.0006);
  });

  it("reserves the worst-case cost of one bounded request", () => {
    expect(maxRequestCostUsd(12_000, 2_000, pricing)).toBeCloseTo(0.003);
  });

  it("detects when another request would exceed the budget", () => {
    expect(exceedsBudget(0.999, 0.003, 1)).toBe(true);
    expect(exceedsBudget(0.5, 0.003, 1)).toBe(false);
  });
});

describe("estimateTokens", () => {
  it("rounds up at roughly four characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
