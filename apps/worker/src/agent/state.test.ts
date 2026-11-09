import { describe, expect, it } from "vitest";
import { getToolRegistry } from "../tools/registry.js";
import { buildResumeState, MAX_EVIDENCE_ITEMS, toolOutputOf, type PersistedStep } from "./state.js";

const registry = getToolRegistry();
const plan = { summary: "Search then answer.", steps: [{ title: "Search", description: "Find sources." }] };
const source = (n: number) => ({
  chunk_id: `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  document_id: "94000000-0000-4000-8000-000000000001",
  file_name: "report.txt", content: `Excerpt ${n}`, similarity: 0.9, metadata: { page: n },
});
const step = (overrides: Partial<PersistedStep>): PersistedStep => ({
  id: crypto.randomUUID(), step_index: 0, step_type: "analysis", title: "Step", status: "completed", tool_name: null,
  input_json: null, output_json: null, requires_approval: false, approved_by: null, approved_at: null, error_message: null,
  ...overrides,
});
const searchStep = (index: number, sources: ReturnType<typeof source>[], status = "completed") => step({
  step_index: index, step_type: "retrieval", tool_name: "search_documents", title: "Search workspace sources", status,
  output_json: status === "completed" ? { sources, search_mode: "semantic" } : null,
});

describe("buildResumeState", () => {
  it("starts empty for a fresh run", () => {
    expect(buildResumeState([], registry)).toMatchObject({ plan: null, evidence: [], completedSteps: [], toolStepsUsed: 0, pendingApproval: null, awaitingApproval: false });
  });

  it("restores the plan, evidence, and tool usage from completed steps", () => {
    const state = buildResumeState([step({ step_type: "planning", output_json: plan }), searchStep(1, [source(1), source(2)])], registry);
    expect(state.plan).toEqual(plan);
    expect(state.evidence.map((item) => item.content)).toEqual(["Excerpt 1", "Excerpt 2"]);
    expect(state.toolStepsUsed).toBe(1);
    expect(state.completedSteps).toEqual([{ tool_name: "search_documents", title: "Search workspace sources", status: "completed", summary: "Found 2 matching source excerpts (report.txt)." }]);
  });

  it("counts failed tool steps toward the step limit and reports their error", () => {
    const state = buildResumeState([step({ step_index: 1, step_type: "tool", tool_name: "calculate", title: "Calculate", status: "failed", error_message: "Division by zero." })], registry);
    expect(state.toolStepsUsed).toBe(1);
    expect(state.completedSteps[0]).toMatchObject({ status: "failed", summary: "Failed: Division by zero." });
  });

  it("restores data references from completed CSV analyses", () => {
    const output = {
      document_id: "94000000-0000-4000-8000-0000000000c5", file_name: "sales.csv", operation: "aggregation",
      rows_total: 10, rows_used: 4, row_start: 2, row_end: 9, columns: ["revenue"], result: { "sum(revenue)": 42 }, notes: [],
    };
    const analysis = step({ step_index: 1, step_type: "tool", tool_name: "analyze_csv", title: "Analyze dataset", output_json: output });
    const state = buildResumeState([analysis], registry);
    expect(state.dataReferences).toEqual([{ step_id: analysis.id, document_id: output.document_id, file_name: "sales.csv", operation: "aggregation", row_start: 2, row_end: 9, rows_used: 4, columns: ["revenue"] }]);
    expect(state.completedSteps[0]?.summary).toContain("sum(revenue)");
  });

  it("identifies approved actions that still need execution", () => {
    const approved = step({ step_index: 2, step_type: "tool", tool_name: "save_report", requires_approval: true, status: "approved", approved_by: "u", approved_at: "now" });
    expect(buildResumeState([approved], registry).pendingApproval?.id).toBe(approved.id);
  });

  it("returns rejections with the reviewer's reason", () => {
    const rejected = step({
      step_index: 2, step_type: "tool", tool_name: "save_report", requires_approval: true, status: "rejected",
      output_json: { approval: {}, decision: { decision: "rejected", reason: "Wrong quarter." } },
    });
    const state = buildResumeState([rejected], registry);
    expect(state.completedSteps[0]).toMatchObject({ status: "rejected", summary: expect.stringContaining("Wrong quarter.") });
    expect(state.pendingApproval).toBeNull();
  });

  it("reads the result of approval steps from output_json.result", () => {
    expect(toolOutputOf({ requires_approval: true, output_json: { approval: {}, result: { ok: 1 } } })).toEqual({ ok: 1 });
    expect(toolOutputOf({ requires_approval: false, output_json: { ok: 2 } })).toEqual({ ok: 2 });
  });

  it("flags undecided approvals", () => {
    expect(buildResumeState([step({ step_type: "tool", tool_name: "save_report", requires_approval: true, status: "waiting_approval" })], registry).awaitingApproval).toBe(true);
  });

  it("ignores an invalid persisted plan so the run re-plans", () => {
    expect(buildResumeState([step({ step_type: "planning", output_json: { summary: "" } })], registry).plan).toBeNull();
  });

  it("restores a completed draft", () => {
    const draft = step({ step_index: 2, output_json: { draft: "Revenue grew." } });
    expect(buildResumeState([draft], registry)).toMatchObject({ draftAnswer: "Revenue grew.", draftStepId: draft.id });
  });

  it("deduplicates and caps evidence", () => {
    const sources = Array.from({ length: 12 }, (_, index) => source(index));
    const state = buildResumeState([searchStep(1, sources.slice(0, 6)), searchStep(2, sources.slice(3))], registry);
    expect(state.evidence).toHaveLength(MAX_EVIDENCE_ITEMS);
    expect(new Set(state.evidence.map((item) => item.chunk_id)).size).toBe(MAX_EVIDENCE_ITEMS);
  });
});
