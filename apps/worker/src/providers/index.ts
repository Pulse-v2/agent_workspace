import { getWorkerEnv } from "../env.js";
import { DemoProvider } from "./demo.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

const providers = new Map<"agent" | "embedding", LLMProvider>();

export function getProvider(purpose: "agent" | "embedding" = "agent"): LLMProvider {
  const cached = providers.get(purpose);
  if (cached) return cached;
  const env = getWorkerEnv();
  const hasKey = purpose === "embedding" ? Boolean(env.EMBEDDING_API_KEY || env.LLM_API_KEY) : Boolean(env.LLM_API_KEY);
  const selected = hasKey && (purpose === "embedding" || env.LLM_PROVIDER === "openai")
    ? new OpenAIProvider()
    : new DemoProvider();
  providers.set(purpose, selected);
  return selected;
}
