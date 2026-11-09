import { describe, expect, it } from "vitest";
import { applyPushedEvent, buildRunView, mergeEvents, parseArtifactMetadata, type RunInputRow, type StepInputRow } from "./view-model";

const run: RunInputRow = {
  id: "run", status: "completed", model: "demo-deterministic", input_tokens: 120, output_tokens: 30,
  estimated_cost_usd: "0.0012", retry_count: 1, started_at: "2026-11-01T10:00:00Z", finished_at: "2026-11-01T10:00:05Z",
  error_code: null, error_message: null,
};
const chunk = (id: string, page: number) => ({
  chunk_id: id, document_id: "doc", file_name: "sales.txt", content: `Excerpt ${id}`, similarity: 0.8, metadata: { page },
});
let index = 0;
const step = (overrides: Partial<StepInputRow>): StepInputRow => ({
  id: `step-${index}`, step_index: index++, step_type: "tool", title: "Step", description: "", status: "completed",
  tool_name: null, input_json: null, output_json: null, requires_approval: false, approved_by: null, approved_at: null,
  started_at: null, finished_at: null, error_message: null, created_at: "2026-11-01T10:00:00Z",
  ...overrides,
});

describe("buildRunView", () => {
  it("extracts plan, sources, data references, approvals, final answer, and usage", () => {
    index = 0;
    const view = buildRunView(run, [
      step({ step_type: "planning", output_json: { summary: "Plan", steps: [{ title: "Search", description: "Find sources." }] } }),
      step({ step_type: "retrieval", tool_name: "search_documents", output_json: { sources: [chunk("c1", 1), chunk("c2", 4)], search_mode: "semantic" } }),
      step({ tool_name: "analyze_csv", output_json: { document_id: "csv", file_name: "sales.csv", operation: "summary", rows_total: 3, rows_used: 3, row_start: 1, row_end: 3, columns: ["revenue"], result: {}, notes: [] } }),
      step({
        tool_name: "save_report", requires_approval: true, status: "completed", approved_by: "u", approved_at: "2026-11-01T10:00:03Z",
        output_json: {
          approval: { action: "Save report", title: "Q3", preview: "# Q3", sources: [], data_references: [], expected_effect: "Creates an artifact." },
          decision: { decision: "approved", reason: null }, result: { artifact_id: "artifact-1" },
        },
      }),
      step({ step_type: "final", output_json: { answer: "Revenue grew.", citations: [{ ...chunk("c2", 4), snippet: "Excerpt c2", quote: "c2" }], data_references: [], verified: true } }),
    ]);
    expect(view.plan?.steps).toHaveLength(1);
    expect(view.timeline).toHaveLength(4);
    expect(view.sources.map((source) => [source.chunk_id, source.cited, source.location])).toEqual([["c2", true, "Page 4"], ["c1", false, "Page 1"]]);
    expect(view.dataReferences[0]).toMatchObject({ file_name: "sales.csv", row_start: 1, row_end: 3 });
    expect(view.approvals[0]).toMatchObject({ status: "completed", result: { artifact_id: "artifact-1" } });
    expect(view.pendingApproval).toBeNull();
    expect(view.final?.verified).toBe(true);
    expect(view.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, estimatedCostUsd: 0.0012, toolCalls: 3, retries: 1 });
    expect(view.isDemo).toBe(true);
  });

  it("exposes the pending approval", () => {
    index = 0;
    const view = buildRunView({ ...run, status: "waiting_approval" }, [step({
      tool_name: "save_report", requires_approval: true, status: "waiting_approval",
      output_json: { approval: { action: "Save report", title: "Q3", preview: "# Q3", expected_effect: "Creates an artifact." } },
    })]);
    expect(view.pendingApproval?.request.title).toBe("Q3");
  });

  it("tolerates malformed step output instead of crashing", () => {
    index = 0;
    const view = buildRunView(run, [
      step({ step_type: "planning", output_json: "not a plan" }),
      step({ tool_name: "search_documents", output_json: { sources: "nope" } }),
      step({ step_type: "final", output_json: { citations: 42 } }),
    ]);
    expect(view.plan).toBeNull();
    expect(view.sources).toEqual([]);
    expect(view.final).toBeNull();
  });
});

describe("mergeEvents", () => {
  it("deduplicates by sequence and orders out-of-order delivery", () => {
    const merged = mergeEvents(
      [{ sequence: 1, type: "a" }, { sequence: 3, type: "c" }],
      [{ sequence: 2, type: "b" }, { sequence: 3, type: "c" }, { sequence: 1, type: "a" }],
    );
    expect(merged.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});

describe("parseArtifactMetadata", () => {
  it("reads agent provenance and ignores malformed fields", () => {
    const parsed = parseArtifactMetadata({ generated_by: "agent", approved_at: "2026-11-01", sources: [chunk("c1", 2)], data_references: "bad" });
    expect(parsed.generated_by).toBe("agent");
    expect(parsed.sources[0]).toMatchObject({ chunk_id: "c1", cited: true, location: "Page 2" });
    expect(parsed.data_references).toEqual([]);
    expect(parseArtifactMetadata(null).sources).toEqual([]);
  });
});

describe("applyPushedEvent", () => {
  const events = [{ sequence: 1 }, { sequence: 2 }];
  it("appends the next event without a gap", () => {
    expect(applyPushedEvent(events, { sequence: 3 })).toEqual({ events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }], gap: false });
  });
  it("ignores duplicates", () => {
    expect(applyPushedEvent(events, { sequence: 2 })).toEqual({ events, gap: false });
  });
  it("detects missed events", () => {
    expect(applyPushedEvent(events, { sequence: 5 }).gap).toBe(true);
  });
  it("places late events in order", () => {
    expect(applyPushedEvent([{ sequence: 1 }, { sequence: 3 }], { sequence: 2 }).events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});
