import { z } from "zod";

/**
 * Turns persisted run rows (run, steps, events) into what the run detail UI
 * renders. Step outputs are JSON written by the worker; they are parsed
 * defensively so a malformed row degrades to "not available" instead of crashing.
 */

const metadataSchema = z.record(z.string(), z.unknown()).catch({});

const sourceSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  file_name: z.string(),
  content: z.string().optional(),
  snippet: z.string().optional(),
  quote: z.string().optional(),
  similarity: z.number().nullable().optional(),
  metadata: metadataSchema.optional().default({}),
});

const dataReferenceSchema = z.object({
  step_id: z.string().optional(),
  document_id: z.string(),
  file_name: z.string(),
  operation: z.string(),
  row_start: z.number().nullable(),
  row_end: z.number().nullable(),
  rows_used: z.number(),
  columns: z.array(z.string()).default([]),
});

const planSchema = z.object({ summary: z.string(), steps: z.array(z.object({ title: z.string(), description: z.string() })) });

const finalSchema = z.object({
  answer: z.string(),
  citations: z.array(sourceSchema).default([]),
  data_references: z.array(dataReferenceSchema).default([]),
  verified: z.boolean().default(false),
});

export const approvalRequestSchema = z.object({
  action: z.string(),
  title: z.string(),
  preview: z.string(),
  preview_truncated: z.boolean().default(false),
  sources: z.array(sourceSchema).default([]),
  data_references: z.array(dataReferenceSchema).default([]),
  expected_effect: z.string(),
});

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decided_by: z.string().nullable().optional(),
  decided_at: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

const approvalOutputSchema = z.object({
  approval: approvalRequestSchema,
  decision: decisionSchema.optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

const searchOutputSchema = z.object({ sources: z.array(sourceSchema), search_mode: z.string().optional() });

export type SourceView = z.infer<typeof sourceSchema> & { cited: boolean; location: string | null };
export type DataReference = z.infer<typeof dataReferenceSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type FinalAnswerView = z.infer<typeof finalSchema>;

export type StepInputRow = {
  id: string; step_index: number; step_type: string; title: string; description: string; status: string;
  tool_name: string | null; input_json: unknown; output_json: unknown; requires_approval: boolean;
  approved_by: string | null; approved_at: string | null; started_at: string | null; finished_at: string | null;
  error_message: string | null; created_at: string;
};
export type EventInputRow = { id: string; sequence: number; event_type: string; payload: unknown; created_at: string };
export type RunInputRow = {
  id: string; status: string; model: string | null; input_tokens: number; output_tokens: number;
  estimated_cost_usd: number | string; retry_count: number; started_at: string | null; finished_at: string | null;
  error_code: string | null; error_message: string | null;
};

export type TimelineItem = {
  id: string; index: number; type: string; title: string; description: string; status: string;
  toolName: string | null; requiresApproval: boolean; startedAt: string | null; finishedAt: string | null;
  error: string | null; input: unknown; output: unknown;
};

export type ApprovalView = {
  stepId: string; status: string; toolName: string | null; request: ApprovalRequest; input: unknown;
  decision: z.infer<typeof decisionSchema> | null; result: Record<string, unknown> | null;
  approvedBy: string | null; approvedAt: string | null;
};

export type RunView = {
  plan: z.infer<typeof planSchema> | null;
  final: FinalAnswerView | null;
  timeline: TimelineItem[];
  sources: SourceView[];
  dataReferences: DataReference[];
  approvals: ApprovalView[];
  pendingApproval: ApprovalView | null;
  usage: {
    model: string | null; inputTokens: number; outputTokens: number; estimatedCostUsd: number;
    steps: number; toolCalls: number; retries: number; startedAt: string | null; finishedAt: string | null;
  };
  isDemo: boolean;
};

export function locationOf(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  if (typeof metadata.page === "number") return `Page ${metadata.page}`;
  if (typeof metadata.row_start === "number") {
    return typeof metadata.row_end === "number" && metadata.row_end !== metadata.row_start
      ? `Rows ${metadata.row_start}–${metadata.row_end}` : `Row ${metadata.row_start}`;
  }
  if (typeof metadata.section === "number") return `Section ${metadata.section}`;
  if (typeof metadata.section === "string") return metadata.section;
  return null;
}

export function buildRunView(run: RunInputRow, steps: StepInputRow[]): RunView {
  const ordered = [...steps].sort((a, b) => a.step_index - b.step_index);
  let plan: RunView["plan"] = null;
  let final: FinalAnswerView | null = null;
  const sources = new Map<string, SourceView>();
  const dataReferences: DataReference[] = [];
  const approvals: ApprovalView[] = [];
  const timeline: TimelineItem[] = [];

  for (const step of ordered) {
    if (step.step_type === "planning") {
      const parsed = planSchema.safeParse(step.output_json);
      if (parsed.success) plan = parsed.data;
      continue;
    }
    timeline.push({
      id: step.id, index: step.step_index, type: step.step_type, title: step.title, description: step.description,
      status: step.status, toolName: step.tool_name, requiresApproval: step.requires_approval,
      startedAt: step.started_at, finishedAt: step.finished_at, error: step.error_message,
      input: step.input_json, output: step.output_json,
    });

    if (step.tool_name === "search_documents" && step.status === "completed") {
      const parsed = searchOutputSchema.safeParse(step.output_json);
      if (parsed.success) {
        for (const source of parsed.data.sources) {
          if (!sources.has(source.chunk_id)) sources.set(source.chunk_id, { ...source, cited: false, location: locationOf(source.metadata) });
        }
      }
    }
    if (step.tool_name === "analyze_csv" && step.status === "completed") {
      const output = step.output_json as Record<string, unknown> | null;
      const parsed = dataReferenceSchema.safeParse({ ...output, step_id: step.id });
      if (parsed.success) dataReferences.push(parsed.data);
    }
    if (step.requires_approval) {
      const parsed = approvalOutputSchema.safeParse(step.output_json);
      if (parsed.success) {
        approvals.push({
          stepId: step.id, status: step.status, toolName: step.tool_name, request: parsed.data.approval, input: step.input_json,
          decision: parsed.data.decision ?? null, result: parsed.data.result ?? null,
          approvedBy: step.approved_by, approvedAt: step.approved_at,
        });
      }
    }
    if (step.step_type === "final" && step.status === "completed") {
      const parsed = finalSchema.safeParse(step.output_json);
      if (parsed.success) final = parsed.data;
    }
  }

  for (const citation of final?.citations ?? []) {
    const existing = sources.get(citation.chunk_id);
    sources.set(citation.chunk_id, {
      ...(existing ?? citation), quote: citation.quote, snippet: citation.snippet ?? existing?.snippet,
      cited: true, location: locationOf(citation.metadata ?? existing?.metadata),
    });
  }

  const toolSteps = timeline.filter((item) => item.type === "retrieval" || item.type === "tool");
  return {
    plan,
    final,
    timeline,
    sources: [...sources.values()].sort((a, b) => Number(b.cited) - Number(a.cited)),
    dataReferences: final?.data_references.length ? final.data_references : dataReferences,
    approvals,
    pendingApproval: approvals.find((approval) => approval.status === "waiting_approval") ?? null,
    usage: {
      model: run.model,
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      estimatedCostUsd: Number(run.estimated_cost_usd),
      steps: timeline.length,
      toolCalls: toolSteps.length,
      retries: run.retry_count,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
    },
    isDemo: run.model === "demo-deterministic",
  };
}

/** Merges events by sequence: idempotent for duplicates and safe for out-of-order delivery. */
export function mergeEvents<T extends { sequence: number }>(current: readonly T[], incoming: readonly T[]): T[] {
  const bySequence = new Map<number, T>();
  for (const event of current) bySequence.set(event.sequence, event);
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

const eventLabels: Record<string, string> = {
  run_created: "Run created",
  run_started: "Run started",
  run_retrying: "Retry scheduled",
  plan_created: "Plan created",
  step_started: "Step started",
  step_completed: "Step completed",
  step_failed: "Step failed",
  tool_call_started: "Tool call started",
  tool_call_completed: "Tool call completed",
  approval_requested: "Approval requested",
  approval_approved: "Approved",
  approval_rejected: "Rejected",
  run_completed: "Run completed",
  run_failed: "Run failed",
  run_cancelled: "Run cancelled",
};
export const eventLabel = (type: string) => eventLabels[type] ?? type.replace(/[_.]/g, " ");

const artifactMetadataSchema = z.object({
  generated_by: z.string().optional(),
  run_id: z.string().optional(),
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
  sources: z.array(sourceSchema).catch([]).default([]),
  data_references: z.array(dataReferenceSchema).catch([]).default([]),
}).catch({ sources: [], data_references: [] });

/** Provenance stored on agent-created artifacts (sources are copies of the excerpts approved with the report). */
export function parseArtifactMetadata(metadata: unknown) {
  const parsed = artifactMetadataSchema.parse(metadata ?? {});
  return {
    ...parsed,
    sources: parsed.sources.map((source): SourceView => ({ ...source, cited: true, location: locationOf(source.metadata) })),
  };
}

/**
 * Applies one pushed event to the loaded run. Returns whether a sequence gap
 * was detected (events missed, e.g. during a reconnect), in which case the
 * caller must resync from the API. Duplicates and late deliveries are no-ops.
 */
export function applyPushedEvent<T extends { sequence: number }>(events: readonly T[], event: T) {
  const lastSequence = events.reduce((max, item) => Math.max(max, item.sequence), 0);
  return { events: mergeEvents(events, [event]), gap: event.sequence > lastSequence + 1 };
}

/** Runs created by `pnpm seed:demo` carry context.seeded_demo = true. */
export function isSeededDemo(context: unknown) {
  return typeof context === "object" && context !== null && (context as { seeded_demo?: unknown }).seeded_demo === true;
}
