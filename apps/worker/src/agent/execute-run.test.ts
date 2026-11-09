import type { ClaimedJob } from "@ai-agent/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";
import { DemoProvider } from "../providers/demo.js";
import { agentPlanSchema, finalAnswerSchema, type AgentAction, type EvidenceItem, type LLMProvider } from "../providers/types.js";
import type { PersistedStep } from "./state.js";

// ---------------------------------------------------------------------------
// In-memory stand-in for the persistence layer. Real tools and the real tool
// registry run on top of it.
// ---------------------------------------------------------------------------
type FakeStep = PersistedStep;

const db = vi.hoisted(() => ({
  run: { status: "queued", cost: 0, errorCode: null as string | null, retryCount: 0, result: null as unknown },
  job: { status: "running" },
  objective: "How did EMEA revenue change?",
  context: {} as Record<string, unknown>,
  role: "member" as string | null,
  steps: [] as FakeStep[],
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  documents: [] as Array<{ id: string; file_name: string; mime_type: string; is_csv: boolean; row_count: number | null; columns: string[] | null }>,
  csvRows: [] as Array<{ index: number; data: Record<string, string> }>,
  artifacts: [] as Array<{ id: string; stepId: string; title: string; metadata: Record<string, unknown> }>,
  approvals: [] as Array<{ toolName: string; input: unknown; approval: Record<string, unknown> }>,
}));

const newStep = (overrides: Partial<FakeStep>): FakeStep => ({
  id: crypto.randomUUID(), step_index: db.steps.length, step_type: "tool", title: "Step", status: "running",
  tool_name: null, input_json: null, output_json: null, requires_approval: false, approved_by: null, approved_at: null, error_message: null,
  ...overrides,
});

vi.mock("../queue/agent-runs.js", () => {
  const event = (type: string, payload: Record<string, unknown> = {}) => db.events.push({ type, payload });
  const step = (id: string) => db.steps.find((item) => item.id === id)!;
  const add = (overrides: Partial<FakeStep>) => {
    const created = newStep({ ...overrides, step_index: db.steps.length });
    db.steps.push(created);
    return created.id;
  };
  return {
    loadAgentRun: async (id: string) => ({ id, organization_id: "org", workspace_id: "ws", title: "Task", objective: db.objective, status: db.run.status, created_by: "creator", context: db.context }),
    getRunStatus: async () => db.run.status,
    getRunCost: async () => db.run.cost,
    heartbeatAgentJob: async () => true,
    loadRunSteps: async () => db.steps.map((item) => ({ ...item })),
    getMemberRole: async () => db.role,
    failInterruptedSteps: async (_runId: string, reason: string) => {
      for (const item of db.steps) {
        if (item.status !== "running") continue;
        if (item.requires_approval && item.approved_by) item.status = "approved";
        else {
          item.status = "failed";
          item.error_message = reason;
          event("step_failed", { step_id: item.id });
        }
      }
    },
    beginAgentRun: async (_run: unknown, input: { model: string; resumed: boolean }) => {
      if (!["queued", "planning", "running"].includes(db.run.status)) return false;
      db.run.status = input.resumed ? "running" : "planning";
      event("run_started", { resumed: input.resumed, model: input.model });
      return true;
    },
    insertPlanStep: async (_run: unknown, plan: unknown) => {
      const id = add({ step_type: "planning", title: "Create execution plan", status: "completed", output_json: plan });
      db.run.status = "running";
      event("plan_created", { step_id: id });
      return id;
    },
    startStep: async (_run: unknown, input: { type: string; title: string; toolName?: string | null; input?: unknown }) => {
      const id = add({ step_type: input.type, title: input.title, tool_name: input.toolName ?? null, input_json: input.input ?? null });
      event("step_started", { step_id: id });
      if (input.toolName) event("tool_call_started", { step_id: id, tool_name: input.toolName });
      return id;
    },
    completeStep: async (_runId: string, id: string, output: unknown, extra: { toolName?: string; mergeAsResult?: boolean } = {}) => {
      const target = step(id);
      if (target.status !== "running") return;
      target.status = "completed";
      target.output_json = extra.mergeAsResult ? { ...(target.output_json as object), result: output } : output;
      if (extra.toolName) event("tool_call_completed", { step_id: id });
      event("step_completed", { step_id: id });
    },
    failStep: async (_runId: string, id: string, message: string) => {
      Object.assign(step(id), { status: "failed", error_message: message });
      event("step_failed", { step_id: id });
    },
    cancelOpenSteps: async () => { for (const item of db.steps) if (item.status === "running") item.status = "cancelled"; },
    recordRejectedToolCall: async (_run: unknown, input: { title: string; toolName: string | null; input: unknown; error: string }) => {
      const id = add({ title: input.title, tool_name: input.toolName, input_json: input.input, status: "failed", error_message: input.error });
      event("step_started", { step_id: id });
      event("step_failed", { step_id: id, error: input.error });
    },
    requestApproval: async (_job: unknown, _workerId: string, _run: unknown, input: { toolName: string; title: string; input: unknown; approval: Record<string, unknown> }) => {
      db.approvals.push(input);
      const id = add({ title: input.title, tool_name: input.toolName, input_json: input.input, output_json: { approval: input.approval }, requires_approval: true, status: "waiting_approval" });
      db.run.status = "waiting_approval";
      db.job.status = "completed";
      event("step_started", { step_id: id });
      event("approval_requested", { step_id: id });
      return id;
    },
    startApprovedStep: async (_runId: string, id: string) => {
      const target = step(id);
      if (target.status !== "approved") return false;
      target.status = "running";
      event("tool_call_started", { step_id: id, approved: true });
      return true;
    },
    addRunUsage: async (_runId: string, usage: { costUsd: number }) => {
      db.run.cost += usage.costUsd;
      return db.run.cost;
    },
    finishAgentRun: async (_job: unknown, _workerId: string, result: unknown) => {
      db.run.status = "completed";
      db.run.result = result;
      db.job.status = "completed";
      event("run_completed");
    },
    finishAgentJob: async () => { db.job.status = "completed"; },
    cancelAgentJob: async () => { db.job.status = "cancelled"; },
    releaseAgentJob: async () => { db.job.status = "queued"; db.run.status = "queued"; },
    failAgentJob: async (_job: unknown, _workerId: string, failure: { code: string }, retry: { retrying: boolean }) => {
      db.job.status = retry.retrying ? "queued" : "failed";
      db.run.status = retry.retrying ? "queued" : "failed";
      db.run.errorCode = failure.code;
      if (retry.retrying) db.run.retryCount += 1;
      event(retry.retrying ? "run_retrying" : "run_failed", { error_code: failure.code });
    },
  };
});

const search = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../queue/database.js", () => ({ searchRunEvidence: search.fn }));

vi.mock("../queue/tool-data.js", () => ({
  listWorkspaceDocuments: async () => db.documents,
  loadCsvDataset: async (_run: unknown, documentId: string) => {
    const document = db.documents.find((item) => item.id === documentId && item.is_csv);
    return document ? { document: { id: document.id, file_name: document.file_name }, rows: db.csvRows } : { error: "No document with this ID exists in the workspace." };
  },
  findExistingChunks: async (_run: unknown, ids: string[]) => new Set(ids),
  insertReportArtifact: async (input: { stepId: string; title: string; metadata: Record<string, unknown> }) => {
    const existing = db.artifacts.find((item) => item.stepId === input.stepId);
    if (existing) return { id: existing.id, created: false };
    const id = crypto.randomUUID();
    db.artifacts.push({ id, stepId: input.stepId, title: input.title, metadata: input.metadata });
    return { id, created: true };
  },
}));

const providerRef = vi.hoisted(() => ({ current: null as LLMProvider | null }));
vi.mock("../providers/index.js", () => ({ getProvider: () => providerRef.current }));

const setObjective = (objective: string) => { db.objective = objective; };

const { executeAgentJob, validateAction, validateCitations } = await import("./execute-run.js");

// ---------------------------------------------------------------------------

const logger = createLogger();
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

const evidence: EvidenceItem[] = [{
  chunk_id: "95000000-0000-4000-8000-000000000001", document_id: "94000000-0000-4000-8000-000000000001",
  file_name: "sales.txt", content: "Revenue in EMEA grew 12% year over year.", similarity: 0.9, metadata: { page: 2 },
}];
const csvDocument = { id: "94000000-0000-4000-8000-0000000000c5", file_name: "sales.csv", mime_type: "text/csv", is_csv: true, row_count: 3, columns: ["region", "revenue"] };

function job(attempts = 1): ClaimedJob {
  return {
    id: "job-1", organization_id: "org", workspace_id: "ws", run_id: "run-1", document_id: null, job_type: "agent_run",
    payload: {}, status: "running", attempts, max_attempts: 5, locked_by: "worker", lease_expires_at: new Date().toISOString(),
  };
}
const run = (attempts = 1, signal = new AbortController().signal) => executeAgentJob(job(attempts), "worker", signal, logger);
const eventTypes = () => db.events.map((item) => item.type);
const planStep = () => newStep({ step_index: 0, step_type: "planning", title: "Plan", status: "completed", output_json: { summary: "Plan", steps: [{ title: "Search", description: "Search." }] } });
const searchStep = (index: number) => newStep({ step_index: index, step_type: "retrieval", title: "Search workspace sources", status: "completed", tool_name: "search_documents", input_json: { query: "q", top_k: 6 }, output_json: { sources: evidence, search_mode: "full_text_demo" } });
const reply = (action: Partial<AgentAction>) => ({
  value: { type: "tool_call", tool_name: null, arguments_json: null, answer: null, ...action } as AgentAction,
  usage: { inputTokens: 0, outputTokens: 0, model: "demo" },
});

beforeEach(() => {
  db.run = { status: "queued", cost: 0, errorCode: null, retryCount: 0, result: null };
  db.job = { status: "running" };
  db.role = "member";
  db.steps = [];
  db.events = [];
  db.documents = [];
  db.csvRows = [];
  db.artifacts = [];
  db.approvals = [];
  db.context = {};
  setObjective("How did EMEA revenue change?");
  providerRef.current = new DemoProvider();
  search.fn.mockReset().mockResolvedValue(evidence);
});

describe("executeAgentJob: core loop", () => {
  it("plans, searches, drafts, and completes with verified citations", async () => {
    await expect(run()).resolves.toBe("completed");
    expect(db.run.status).toBe("completed");
    expect(db.job.status).toBe("completed");
    expect(db.steps.map((item) => [item.step_type, item.status])).toEqual([
      ["planning", "completed"], ["retrieval", "completed"], ["analysis", "completed"], ["final", "completed"],
    ]);
    expect(eventTypes()).toEqual([
      "run_started", "plan_created",
      "step_started", "tool_call_started", "tool_call_completed", "step_completed",
      "step_started", "step_completed",
      "step_started", "step_completed",
      "run_completed",
    ]);
    expect(db.run.result).toMatchObject({ verified: true, citations: [{ chunk_id: evidence[0]!.chunk_id, file_name: "sales.txt" }] });
  });

  it("scopes search to the run's workspace, not to model input", async () => {
    await run();
    expect(search.fn).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", workspaceId: "ws" }));
  });

  it("analyzes CSV datasets and returns data references with row ranges", async () => {
    db.documents = [csvDocument];
    db.csvRows = [
      { index: 1, data: { region: "EMEA", revenue: "100" } },
      { index: 2, data: { region: "APAC", revenue: "80" } },
      { index: 3, data: { region: "EMEA", revenue: "120" } },
    ];
    await run();
    const analysis = db.steps.find((item) => item.tool_name === "analyze_csv");
    expect(analysis?.status).toBe("completed");
    expect(db.run.result).toMatchObject({ data_references: [{ document_id: csvDocument.id, operation: "summary", row_start: 1, row_end: 3, rows_used: 3 }] });
  });

  it("limits search and analysis to the documents selected for the task", async () => {
    db.documents = [csvDocument];
    db.context = { document_ids: [csvDocument.id] };
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep")
      .mockResolvedValueOnce(reply({ tool_name: "search_documents", arguments_json: JSON.stringify({ query: "revenue" }) }))
      .mockResolvedValueOnce(reply({ tool_name: "analyze_csv", arguments_json: JSON.stringify({ operation: "summary", document_id: "94000000-0000-4000-8000-0000000000ff" }) }))
      .mockResolvedValueOnce(reply({ type: "final_answer", answer: "Done." }));
    providerRef.current = provider;
    await run();
    expect(search.fn).toHaveBeenCalledWith(expect.objectContaining({ documentIds: [csvDocument.id] }));
    expect(db.steps.find((item) => item.tool_name === "analyze_csv")).toMatchObject({ status: "failed", error_message: expect.stringMatching(/not one of the documents selected/) });
  });

  it("records invalid tool calls as failed steps and lets the agent continue", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep")
      .mockResolvedValueOnce(reply({ tool_name: "run_sql", arguments_json: "{\"sql\":\"drop table\"}" }))
      .mockResolvedValueOnce(reply({ tool_name: "calculate", arguments_json: "{\"kind\":\"expression\",\"expression\":\"1/0\"}" }))
      .mockResolvedValueOnce(reply({ type: "final_answer", answer: "Done." }));
    providerRef.current = provider;
    await run();
    const failed = db.steps.filter((item) => item.status === "failed");
    expect(failed.map((item) => item.error_message)).toEqual([expect.stringMatching(/Unknown tool "run_sql"/), "Division by zero."]);
    expect(db.run.status).toBe("completed");
    const lastCall = vi.mocked(provider.executeStep).mock.calls.at(-1)![0];
    expect(lastCall.completedSteps.map((item) => item.status)).toEqual(["failed", "failed"]);
  });

  it("rejects malformed arguments before execution and counts them toward the step limit", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep")
      .mockResolvedValueOnce(reply({ tool_name: "calculate", arguments_json: "not json" }))
      .mockResolvedValueOnce(reply({ tool_name: "calculate", arguments_json: "{\"kind\":\"eval\",\"code\":\"1\"}" }))
      .mockResolvedValueOnce(reply({ tool_name: "calculate", arguments_json: "{\"kind\":\"expression\",\"expression\":\"2+2\"}" }));
    providerRef.current = provider;
    await run();
    expect(db.steps.filter((item) => item.tool_name === "calculate").map((item) => item.status)).toEqual(["failed", "failed", "completed"]);
    expect(db.steps[1]?.error_message).toBe("arguments_json is not valid JSON.");
    expect(db.steps[2]?.error_message).toMatch(/^Invalid arguments/);
    expect(db.run.errorCode).toBe("step_limit_exceeded");
  });

  it("resumes from persisted steps without re-planning or repeating searches", async () => {
    const provider = new DemoProvider();
    const planSpy = vi.spyOn(provider, "generatePlan");
    providerRef.current = provider;
    db.steps = [planStep(), searchStep(1), newStep({ step_index: 2, step_type: "analysis", title: "Draft", status: "running" })];
    await run(2);
    expect(planSpy).not.toHaveBeenCalled();
    expect(search.fn).not.toHaveBeenCalled();
    expect(db.steps[2]?.status).toBe("failed");
    expect(db.events.find((item) => item.type === "run_started")?.payload).toMatchObject({ resumed: true });
    expect(db.run.status).toBe("completed");
  });
});

describe("executeAgentJob: approvals", () => {
  beforeEach(() => setObjective("Summarize revenue and save a report."));

  it("pauses for approval with a preview, sources, and expected effect", async () => {
    await expect(run()).resolves.toBe("paused_for_approval");
    expect(db.run.status).toBe("waiting_approval");
    expect(db.job.status).toBe("completed");
    expect(db.artifacts).toHaveLength(0);
    expect(db.approvals).toHaveLength(1);
    expect(db.approvals[0]).toMatchObject({
      toolName: "save_report",
      approval: {
        action: "Save report as a workspace artifact",
        sources: [{ chunk_id: evidence[0]!.chunk_id, file_name: "sales.txt" }],
        expected_effect: expect.stringContaining("Creates a new report artifact"),
      },
    });
    expect(eventTypes()).toContain("approval_requested");
    expect(eventTypes()).not.toContain("run_completed");
  });

  it("decides approval from the registry even when the model calls it a plain tool call", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep").mockResolvedValueOnce(reply({
      type: "tool_call", tool_name: "save_report", arguments_json: JSON.stringify({ title: "R", content_markdown: "# R" }),
    }));
    providerRef.current = provider;
    await run();
    expect(db.run.status).toBe("waiting_approval");
    expect(db.artifacts).toHaveLength(0);
  });

  it("rejects reports that cite chunks not retrieved in the run", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep")
      .mockResolvedValueOnce(reply({ tool_name: "save_report", arguments_json: JSON.stringify({ title: "R", content_markdown: "# R", source_chunk_ids: ["96000000-0000-4000-8000-000000000009"] }) }))
      .mockResolvedValueOnce(reply({ type: "final_answer", answer: "Done." }));
    providerRef.current = provider;
    await run();
    expect(db.approvals).toHaveLength(0);
    expect(db.steps.find((item) => item.tool_name === "save_report")?.error_message).toMatch(/not retrieved in this run/);
  });

  it("executes an approved action exactly once after resume, then completes", async () => {
    await run();
    const pending = db.steps.find((item) => item.status === "waiting_approval")!;
    // Simulate decide_agent_run_approval().
    Object.assign(pending, { status: "approved", approved_by: "approver", approved_at: new Date().toISOString() });
    db.run.status = "queued";
    db.job.status = "running";

    const provider = new DemoProvider();
    const planSpy = vi.spyOn(provider, "generatePlan");
    providerRef.current = provider;
    await run(1);

    expect(planSpy).not.toHaveBeenCalled();
    expect(db.artifacts).toHaveLength(1);
    expect(db.artifacts[0]?.metadata).toMatchObject({ approved_by: "approver", step_id: pending.id });
    expect(pending.status).toBe("completed");
    expect(pending.output_json).toMatchObject({ approval: expect.any(Object), result: { artifact_id: db.artifacts[0]!.id, created: true } });
    expect(db.run.status).toBe("completed");
    expect(db.approvals).toHaveLength(1);
  });

  it("re-executes an interrupted approved action idempotently", async () => {
    await run();
    const pending = db.steps.find((item) => item.status === "waiting_approval")!;
    Object.assign(pending, { status: "running", approved_by: "approver", approved_at: new Date().toISOString() });
    db.artifacts.push({ id: "97000000-0000-4000-8000-000000000001", stepId: pending.id, title: "x", metadata: {} });
    db.run.status = "queued";
    db.job.status = "running";
    await run(2);
    expect(db.artifacts).toHaveLength(1);
    expect(pending.output_json).toMatchObject({ result: { created: false } });
    expect(db.run.status).toBe("completed");
  });

  it("returns a rejection to the agent instead of executing it", async () => {
    await run();
    const pending = db.steps.find((item) => item.status === "waiting_approval")!;
    Object.assign(pending, {
      status: "rejected", approved_by: "approver", approved_at: new Date().toISOString(),
      output_json: { ...(pending.output_json as object), decision: { decision: "rejected", reason: "Numbers are not final." } },
    });
    db.run.status = "queued";
    db.job.status = "running";
    const provider = new DemoProvider();
    const stepSpy = vi.spyOn(provider, "executeStep");
    providerRef.current = provider;
    await run(1);
    expect(db.artifacts).toHaveLength(0);
    expect(db.run.status).toBe("completed");
    const completed = stepSpy.mock.calls[0]![0].completedSteps;
    expect(completed.find((item) => item.tool_name === "save_report")).toMatchObject({ status: "rejected", summary: expect.stringContaining("Numbers are not final.") });
  });

  it("revalidates stored input and refuses to execute it when invalid", async () => {
    db.steps = [planStep(), searchStep(1), newStep({
      step_index: 2, title: "Save report", tool_name: "save_report", requires_approval: true, status: "approved",
      approved_by: "approver", approved_at: new Date().toISOString(), input_json: { title: "", content_markdown: "" },
      output_json: { approval: {} },
    })];
    await run();
    expect(db.artifacts).toHaveLength(0);
    expect(db.steps[2]).toMatchObject({ status: "failed", error_message: expect.stringMatching(/failed revalidation/) });
  });

  it("does not execute when the run creator lost permission", async () => {
    db.role = "viewer";
    await run();
    expect(db.run.status).toBe("failed");
    expect(db.run.errorCode).toBe("permission_denied");
    expect(search.fn).not.toHaveBeenCalled();
  });

  it("does not run a job while an approval is undecided", async () => {
    db.steps = [planStep(), newStep({ step_index: 1, tool_name: "save_report", requires_approval: true, status: "waiting_approval" })];
    await run();
    expect(db.job.status).toBe("completed");
    expect(db.events).toEqual([]);
  });
});

describe("executeAgentJob: failures and stops", () => {
  it("re-queues the run on a transient failure", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "generatePlan").mockRejectedValue(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    providerRef.current = provider;
    await expect(run(1)).resolves.toBe("retrying");
    expect(db.run.status).toBe("queued");
    expect(db.run.errorCode).toBe("database_unavailable");
    expect(eventTypes()).toContain("run_retrying");
  });

  it("fails permanently once retries are exhausted", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "generatePlan").mockRejectedValue(new Error("boom"));
    providerRef.current = provider;
    await run(4);
    expect(db.run.status).toBe("failed");
  });

  it("stops at the step limit without retrying", async () => {
    const provider = new DemoProvider();
    vi.spyOn(provider, "executeStep").mockResolvedValue(reply({ tool_name: "search_documents", arguments_json: "{\"query\":\"again\"}" }));
    providerRef.current = provider;
    await run();
    expect(search.fn).toHaveBeenCalledTimes(3);
    expect(db.run.errorCode).toBe("step_limit_exceeded");
    expect(db.run.status).toBe("failed");
  });

  it("enforces the estimated cost limit for real providers", async () => {
    const provider = new DemoProvider();
    Object.defineProperty(provider, "isDemo", { value: false });
    vi.spyOn(provider, "generatePlan").mockResolvedValue({
      value: { summary: "Plan", steps: [{ title: "Search", description: "Search." }] },
      usage: { inputTokens: 10_000_000, outputTokens: 0, model: "test-model" },
    });
    providerRef.current = provider;
    await run();
    expect(db.run.errorCode).toBe("cost_limit_exceeded");
  });

  it("marks a crashing tool step failed and retries the run", async () => {
    search.fn.mockRejectedValue(new Error("storage offline"));
    await run();
    expect(db.steps.find((item) => item.step_type === "retrieval")?.status).toBe("failed");
    expect(db.run.errorCode).toBe("tool_failed");
    expect(db.run.status).toBe("queued");
  });

  it("stops without completing when the user cancels mid-run", async () => {
    search.fn.mockImplementation(async () => {
      db.run.status = "cancelled";
      return evidence;
    });
    await run();
    expect(db.job.status).toBe("cancelled");
    expect(eventTypes()).not.toContain("run_completed");
    expect(db.steps.some((item) => item.status === "running")).toBe(false);
  });

  it("hands the job back on graceful shutdown", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(1, controller.signal)).resolves.toBe("released");
    expect(db.job.status).toBe("queued");
    expect(eventTypes()).not.toContain("run_failed");
  });

  it("skips jobs whose run already finished", async () => {
    db.run.status = "completed";
    await run();
    expect(db.job.status).toBe("completed");
    expect(db.events).toEqual([]);
  });
});

describe("validateAction", () => {
  const base = { tool_name: null, arguments_json: null, answer: null };

  it("requires a tool name for tool calls and an answer for final answers", () => {
    expect(() => validateAction({ ...base, type: "tool_call" })).toThrow(/without a tool name/);
    expect(() => validateAction({ ...base, type: "final_answer", answer: "  " })).toThrow(/empty final answer/);
  });

  it("narrows tool calls and keeps raw arguments for schema validation", () => {
    expect(validateAction({ ...base, type: "approval_request", tool_name: " save_report ", arguments_json: null }))
      .toEqual({ type: "tool_call", toolName: "save_report", argumentsJson: "{}", requestedApproval: true });
  });
});

describe("schemas", () => {
  it("reject empty plans and non-UUID citations", () => {
    expect(agentPlanSchema.safeParse({ summary: "", steps: [] }).success).toBe(false);
    expect(finalAnswerSchema.safeParse({ answer: "a", citations: [{ chunk_id: "not-a-uuid", quote: "q" }] }).success).toBe(false);
  });
});

describe("validateCitations", () => {
  it("keeps only citations whose chunk was retrieved and whose quote is verbatim", () => {
    const result = validateCitations({ answer: "Revenue grew.", citations: [
      { chunk_id: evidence[0]!.chunk_id, quote: "grew 12%" },
      { chunk_id: evidence[0]!.chunk_id, quote: "invented quote" },
      { chunk_id: "96000000-0000-4000-8000-000000000001", quote: "fabricated source" },
    ] }, evidence);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ snippet: evidence[0]!.content, quote: "grew 12%", metadata: { page: 2 } });
  });

  it("replaces unsupported answers with an explicit unverified statement", () => {
    const result = validateCitations({ answer: "Unsupported claim", citations: [] }, evidence);
    expect(result.verified).toBe(false);
    expect(result.answer).toMatch(/could not verify/i);
  });

  it("accepts answers backed by structured data analysis", () => {
    const result = validateCitations({ answer: "EMEA revenue was 220.", citations: [] }, [], [{
      step_id: "s", document_id: "d", file_name: "sales.csv", operation: "aggregation", row_start: 1, row_end: 3, rows_used: 2, columns: ["revenue"],
    }]);
    expect(result).toMatchObject({ verified: true, answer: "EMEA revenue was 220." });
  });
});
