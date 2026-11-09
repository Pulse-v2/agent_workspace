import { agentPlanSchema, type AgentPlan, type CompletedStep, type EvidenceItem } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { DataReference } from "../tools/types.js";

export type PersistedStep = {
  id: string;
  step_index: number;
  step_type: string;
  title: string;
  status: string;
  tool_name: string | null;
  input_json: unknown;
  output_json: unknown;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  error_message: string | null;
};

export type ResumeState = {
  plan: AgentPlan | null;
  evidence: EvidenceItem[];
  dataReferences: DataReference[];
  completedSteps: CompletedStep[];
  toolStepsUsed: number;
  draftAnswer: string | null;
  draftStepId: string | null;
  /** Approved step whose tool has not executed yet. */
  pendingApproval: PersistedStep | null;
  /** A step is still waiting for a user decision. */
  awaitingApproval: boolean;
};

export const MAX_EVIDENCE_ITEMS = 8;
export const MAX_DATA_REFERENCES = 20;

export function addEvidence(evidence: EvidenceItem[], sources: EvidenceItem[]) {
  for (const source of sources) {
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
    if (!evidence.some((item) => item.chunk_id === source.chunk_id)) evidence.push(source);
  }
}

export function addDataReferences(references: DataReference[], added: DataReference[]) {
  for (const reference of added) if (references.length < MAX_DATA_REFERENCES) references.push(reference);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Output of an approval-required step is stored as { approval, decision, result }. */
export function toolOutputOf(step: Pick<PersistedStep, "requires_approval" | "output_json">) {
  return step.requires_approval ? (isRecord(step.output_json) ? step.output_json.result : undefined) : step.output_json;
}

function rejectionReason(step: PersistedStep) {
  const decision = isRecord(step.output_json) && isRecord(step.output_json.decision) ? step.output_json.decision : null;
  return typeof decision?.reason === "string" && decision.reason ? decision.reason : null;
}

/**
 * Rebuilds in-memory agent state from persisted steps so a retried, reclaimed,
 * or approval-resumed job continues where it stopped instead of re-planning,
 * re-running tools, or exceeding the step limit.
 */
export function buildResumeState(steps: PersistedStep[], registry: ToolRegistry): ResumeState {
  const state: ResumeState = {
    plan: null, evidence: [], dataReferences: [], completedSteps: [], toolStepsUsed: 0,
    draftAnswer: null, draftStepId: null, pendingApproval: null, awaitingApproval: false,
  };
  for (const step of [...steps].sort((a, b) => a.step_index - b.step_index)) {
    if (step.step_type === "planning") {
      const parsed = agentPlanSchema.safeParse(step.output_json);
      if (step.status === "completed" && parsed.success) state.plan = parsed.data;
      continue;
    }
    if (step.step_type === "analysis") {
      if (step.status === "completed" && isRecord(step.output_json) && typeof step.output_json.draft === "string" && step.output_json.draft) {
        state.draftAnswer = step.output_json.draft;
        state.draftStepId = step.id;
      }
      continue;
    }
    if (step.step_type !== "retrieval" && step.step_type !== "tool") continue;

    // Every attempted tool call counts, including failed and rejected ones,
    // so retries and resumes cannot be used to exceed MAX_AGENT_STEPS.
    state.toolStepsUsed += 1;
    const tool = step.tool_name ? registry.get(step.tool_name) : null;
    const base = { tool_name: step.tool_name, title: step.title };

    switch (step.status) {
      case "completed": {
        const output = toolOutputOf(step);
        state.completedSteps.push({ ...base, status: "completed", summary: tool?.summarize(output) ?? "Completed." });
        if (tool) {
          addEvidence(state.evidence, tool.evidenceFrom(output));
          addDataReferences(state.dataReferences, tool.dataReferencesFrom(output, step.id));
        }
        break;
      }
      case "failed":
        state.completedSteps.push({ ...base, status: "failed", summary: `Failed: ${step.error_message ?? "unknown error"}` });
        break;
      case "rejected": {
        const reason = rejectionReason(step);
        state.completedSteps.push({ ...base, status: "rejected", summary: `The user rejected this action${reason ? `: ${reason}` : "."} Do not request it again unchanged.` });
        break;
      }
      case "approved":
        state.pendingApproval = step;
        break;
      case "waiting_approval":
        state.awaitingApproval = true;
        break;
    }
  }
  return state;
}
