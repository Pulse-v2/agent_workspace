import type { ProviderUsage } from "../providers/types.js";

export type Pricing = { inputPerMillion: number; outputPerMillion: number };

/** Estimated cost in USD from token usage. This is an estimate, not a provider invoice. */
export function estimateCostUsd(usage: Pick<ProviderUsage, "inputTokens" | "outputTokens">, pricing: Pricing) {
  return (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) / 1_000_000;
}

/** Worst-case cost of one bounded provider request. */
export function maxRequestCostUsd(maxInputTokens: number, maxOutputTokens: number, pricing: Pricing) {
  return estimateCostUsd({ inputTokens: maxInputTokens, outputTokens: maxOutputTokens }, pricing);
}

/**
 * Conservative token estimate used to reject oversized prompts before sending
 * them. ~4 characters per token for English text; rounding up keeps it safe.
 */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/** True when another worst-case request would push the run over its budget. */
export function exceedsBudget(currentCostUsd: number, nextRequestCostUsd: number, maxCostUsd: number) {
  return currentCostUsd + nextRequestCostUsd > maxCostUsd;
}
