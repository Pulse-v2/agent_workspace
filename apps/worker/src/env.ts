import { z } from "zod";

/** Must match vector(N) on public.document_chunks.embedding. */
export const VECTOR_INDEX_DIMENSIONS = 1536;

const workerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.url(),
  LLM_PROVIDER: z.enum(["openai", "demo"]),
  LLM_API_KEY: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  MAX_AGENT_STEPS: z.coerce.number().int().positive(),
  MAX_AGENT_DURATION_MS: z.coerce.number().int().positive(),
  MAX_AGENT_COST_USD: z.coerce.number().positive(),
  MAX_AGENT_RETRIES: z.coerce.number().int().positive().default(3),
  MAX_INPUT_TOKENS: z.coerce.number().int().positive().default(12000),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2000),
  LLM_INPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.15),
  LLM_OUTPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.6),
  DEMO_MODE: z.stringbool(),
}).superRefine((env, context) => {
  if (env.EMBEDDING_DIMENSIONS !== VECTOR_INDEX_DIMENSIONS) {
    context.addIssue({
      code: "custom",
      path: ["EMBEDDING_DIMENSIONS"],
      message: `EMBEDDING_DIMENSIONS must be ${VECTOR_INDEX_DIMENSIONS} to match the document_chunks vector column.`,
    });
  }
  if (!env.DEMO_MODE && env.LLM_PROVIDER === "openai" && !env.LLM_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["LLM_API_KEY"],
      message: "LLM_API_KEY is required for the OpenAI provider when DEMO_MODE is false.",
    });
  }
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

let cached: WorkerEnv | undefined;

/** Validates process.env once; the worker fails fast on startup when configuration is invalid. */
export function getWorkerEnv(): WorkerEnv {
  cached ??= workerEnvSchema.parse(process.env);
  return cached;
}

/** Test helper: forces the next getWorkerEnv() call to re-read process.env. */
export function resetWorkerEnvCache() {
  cached = undefined;
}
