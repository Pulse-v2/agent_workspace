import type { OrganizationRole } from "@ai-agent/shared";
import { z } from "zod";
import type { EvidenceItem } from "../providers/types.js";
import type { AgentRunRecord } from "../queue/agent-runs.js";

/** Reference to structured data (CSV rows/aggregations) that supports an answer. */
export type DataReference = {
  step_id: string;
  document_id: string;
  file_name: string;
  operation: string;
  row_start: number | null;
  row_end: number | null;
  rows_used: number;
  columns: string[];
};

export type ToolContext = {
  run: AgentRunRecord;
  /** Role of the run creator, re-read from the database before every execution. */
  actorRole: OrganizationRole;
  stepId: string;
  signal: AbortSignal;
  /** Evidence and data references gathered earlier in this run. */
  evidence: readonly EvidenceItem[];
  dataReferences: readonly DataReference[];
  /** Present only when an approval-required tool executes after approval. */
  approval?: { approvedBy: string; approvedAt: string };
  /** Documents selected for the task; null means the whole workspace. Enforced by tools. */
  documentScope: readonly string[] | null;
};

/**
 * The model can fix this error itself (bad column, unknown document, division
 * by zero...). It is recorded on the step and returned to the model instead of
 * failing or retrying the run.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export type ApprovalRequest = {
  action: string;
  title: string;
  preview: string;
  preview_truncated: boolean;
  sources: Array<{ chunk_id: string; document_id: string; file_name: string; snippet: string; metadata: Record<string, unknown> }>;
  data_references: Array<Omit<DataReference, "step_id"> & { step_id: string }>;
  expected_effect: string;
};

export type ToolDefinition<I, O> = {
  name: string;
  /** Short, user-visible step title. */
  title: string;
  /** Description shown to the model. */
  description: string;
  stepType: "retrieval" | "tool";
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Roles the run creator must hold for the tool to execute. */
  allowedRoles: readonly OrganizationRole[];
  /** If true the engine pauses the run and the tool executes only after an authorized user approves. */
  requiresApproval: boolean;
  execute(input: I, context: ToolContext): Promise<O>;
  /** Builds the approval request shown to users. Required when requiresApproval is true. */
  describeApproval?(input: I, context: ToolContext): ApprovalRequest;
  /** Concise result summary returned to the model (never raw document dumps). */
  summarize(output: O): string;
  evidenceFrom?(output: O): EvidenceItem[];
  dataReferencesFrom?(output: O, stepId: string): DataReference[];
};

export type InputValidation = { success: true; data: unknown } | { success: false; error: string };

/** Type-erased tool used by the engine. Every entry point validates with the tool's own schemas. */
export type RegisteredTool = {
  name: string;
  title: string;
  description: string;
  stepType: "retrieval" | "tool";
  requiresApproval: boolean;
  allowedRoles: readonly OrganizationRole[];
  inputJsonSchema: Record<string, unknown>;
  validateInput(raw: unknown): InputValidation;
  run(input: unknown, context: ToolContext): Promise<unknown>;
  describeApproval(input: unknown, context: ToolContext): ApprovalRequest;
  summarize(output: unknown): string | null;
  evidenceFrom(output: unknown): EvidenceItem[];
  dataReferencesFrom(output: unknown, stepId: string): DataReference[];
};

export function formatZodIssues(error: z.ZodError) {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
}

export function defineTool<I, O>(definition: ToolDefinition<I, O>): RegisteredTool {
  if (definition.requiresApproval && !definition.describeApproval) {
    throw new Error(`Tool ${definition.name} requires approval but has no approval description.`);
  }
  const parseOutput = (output: unknown) => definition.outputSchema.safeParse(output);
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    stepType: definition.stepType,
    requiresApproval: definition.requiresApproval,
    allowedRoles: definition.allowedRoles,
    inputJsonSchema: z.toJSONSchema(definition.inputSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    validateInput(raw) {
      const parsed = definition.inputSchema.safeParse(raw);
      return parsed.success ? { success: true, data: parsed.data } : { success: false, error: formatZodIssues(parsed.error) };
    },
    async run(input, context) {
      // Re-parse: inputs may come from storage (approved steps) and must be revalidated.
      const parsedInput = definition.inputSchema.parse(input);
      const output = await definition.execute(parsedInput, context);
      return definition.outputSchema.parse(output);
    },
    describeApproval(input, context) {
      if (!definition.describeApproval) throw new Error(`Tool ${definition.name} does not support approval.`);
      return definition.describeApproval(definition.inputSchema.parse(input), context);
    },
    summarize(output) {
      const parsed = parseOutput(output);
      return parsed.success ? definition.summarize(parsed.data) : null;
    },
    evidenceFrom(output) {
      const parsed = parseOutput(output);
      return parsed.success && definition.evidenceFrom ? definition.evidenceFrom(parsed.data) : [];
    },
    dataReferencesFrom(output, stepId) {
      const parsed = parseOutput(output);
      return parsed.success && definition.dataReferencesFrom ? definition.dataReferencesFrom(parsed.data, stepId) : [];
    },
  };
}
