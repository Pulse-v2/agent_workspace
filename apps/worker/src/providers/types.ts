import { z } from "zod";

export const agentPlanSchema = z.object({
  summary: z.string().min(1).max(500),
  steps: z.array(z.object({ title: z.string().min(1).max(120), description: z.string().min(1).max(500) })).min(1).max(8),
});
export type AgentPlan = z.infer<typeof agentPlanSchema>;

/**
 * Flat shape required by strict structured-output modes (every field present,
 * unused fields null). Tool arguments travel as a JSON string because each tool
 * has its own schema; the engine parses and validates them with that schema.
 * "approval_request" is informational: whether a tool needs approval is decided
 * by the tool registry, never by the model.
 */
export const agentActionSchema = z.object({
  type: z.enum(["tool_call", "approval_request", "final_answer"]),
  tool_name: z.string().max(80).nullable(),
  arguments_json: z.string().max(60_000).nullable(),
  answer: z.string().max(12000).nullable(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

export type ValidatedAction =
  | { type: "tool_call"; toolName: string; argumentsJson: string; requestedApproval: boolean }
  | { type: "final_answer"; answer: string };

/** Tool description given to providers (no executable code). */
export type ToolSpec = {
  name: string;
  description: string;
  requires_approval: boolean;
  input_schema: Record<string, unknown>;
};

/** Workspace documents the model may reference by ID (metadata only, never content). */
export type DocumentInfo = {
  id: string; file_name: string; mime_type: string; is_csv: boolean;
  row_count: number | null; columns: string[] | null;
};

/** What the model learns about earlier steps: concise summaries, never hidden reasoning. */
export type CompletedStep = {
  tool_name: string | null;
  title: string;
  status: "completed" | "failed" | "rejected";
  summary: string;
};

export const finalAnswerSchema = z.object({
  answer: z.string().min(1).max(12000),
  citations: z.array(z.object({ chunk_id: z.guid(), quote: z.string().min(1).max(600) })).max(20),
});
export type FinalAnswer = z.infer<typeof finalAnswerSchema>;

export type ProviderUsage = { inputTokens: number; outputTokens: number; model: string };
export type ProviderResult<T> = { value: T; usage: ProviderUsage };
export type EvidenceItem = {
  chunk_id: string; document_id: string; file_name: string; content: string;
  similarity: number | null; metadata: Record<string, unknown>;
};

export type PlanInput = { objective: string; title: string; availableDocuments: number };
export type StepInput = {
  objective: string; plan: AgentPlan; stepIndex: number; maxSteps: number;
  completedSteps: CompletedStep[];
  evidence: EvidenceItem[];
  tools: ToolSpec[];
  documents: DocumentInfo[];
};
export type FinalAnswerInput = { objective: string; draftAnswer: string; evidence: EvidenceItem[]; completedSteps: CompletedStep[] };

/** Per-call options. The signal aborts in-flight provider requests on cancellation or shutdown. */
export type ProviderCallOptions = { signal?: AbortSignal };

/**
 * Provider contract. Implementations own request/response mapping and must
 * throw AgentError (see agent/errors.ts) for failures they can classify.
 * Returned values must already be validated against the schemas above.
 */
export interface LLMProvider {
  readonly name: string;
  /** Model identifier recorded on the run (e.g. "gpt-4o-mini" or "demo-deterministic"). */
  readonly model: string;
  /** True for deterministic providers whose output is not real model execution. */
  readonly isDemo: boolean;
  generatePlan(input: PlanInput, options?: ProviderCallOptions): Promise<ProviderResult<AgentPlan>>;
  executeStep(input: StepInput, options?: ProviderCallOptions): Promise<ProviderResult<AgentAction>>;
  generateFinalAnswer(input: FinalAnswerInput, options?: ProviderCallOptions): Promise<ProviderResult<FinalAnswer>>;
  generateEmbeddings(texts: string[], options?: ProviderCallOptions): Promise<ProviderResult<number[][]>>;
}
