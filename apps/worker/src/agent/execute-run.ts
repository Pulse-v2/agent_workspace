import type { ClaimedJob, OrganizationRole } from "@ai-agent/shared";
import { z } from "zod";
import { getWorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";
import type { AgentJobOutcome } from "../observability/metrics.js";
import { getProvider } from "../providers/index.js";
import type {
  AgentAction, CompletedStep, EvidenceItem, FinalAnswer, ProviderResult, ValidatedAction,
} from "../providers/types.js";
import {
  addRunUsage, beginAgentRun, cancelAgentJob, cancelOpenSteps, completeStep, failAgentJob, failInterruptedSteps,
  failStep, finishAgentJob, finishAgentRun, getMemberRole, getRunCost, getRunStatus, heartbeatAgentJob,
  insertPlanStep, loadAgentRun, loadRunSteps, recordRejectedToolCall, releaseAgentJob, requestApproval,
  startApprovedStep, startStep, type AgentRunRecord,
} from "../queue/agent-runs.js";
import { listWorkspaceDocuments } from "../queue/tool-data.js";
import { getToolRegistry } from "../tools/registry.js";
import { ToolInputError, type DataReference, type RegisteredTool, type ToolContext } from "../tools/types.js";
import { AgentError, classifyError, retryDelaySeconds, shouldRetry } from "./errors.js";
import { estimateCostUsd, exceedsBudget, maxRequestCostUsd } from "./limits.js";
import { addDataReferences, addEvidence, buildResumeState, type PersistedStep } from "./state.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const EXECUTING_ROLES: readonly OrganizationRole[] = ["admin", "member"];

/** Narrows the flat structured-output action. Tool arguments are validated later by the selected tool's schema. */
export function validateAction(action: AgentAction): ValidatedAction {
  if (action.type === "final_answer") {
    if (!action.answer?.trim()) throw new AgentError("invalid_model_output", "The model returned an empty final answer.", true);
    return { type: "final_answer", answer: action.answer.trim() };
  }
  if (!action.tool_name?.trim()) {
    throw new AgentError("invalid_model_output", "The model requested a tool call without a tool name.", true);
  }
  return {
    type: "tool_call",
    toolName: action.tool_name.trim(),
    argumentsJson: action.arguments_json?.trim() || "{}",
    requestedApproval: action.type === "approval_request",
  };
}

/**
 * Keeps only citations that point at retrieved chunks and whose quote appears
 * verbatim in that chunk. Snippets always come from stored source text, never
 * from model output. An answer counts as supported if it has a verified
 * citation or is backed by structured data analysis; otherwise it is replaced
 * by an explicit "could not verify" statement.
 */
export function validateCitations(answer: FinalAnswer, evidence: EvidenceItem[], dataReferences: readonly DataReference[] = []) {
  const byId = new Map(evidence.map((item) => [item.chunk_id, item]));
  const seen = new Set<string>();
  const citations = answer.citations.flatMap((citation) => {
    const source = byId.get(citation.chunk_id);
    if (!source || !source.content.includes(citation.quote) || seen.has(source.chunk_id)) return [];
    seen.add(source.chunk_id);
    return [{
      document_id: source.document_id,
      file_name: source.file_name,
      chunk_id: source.chunk_id,
      snippet: source.content.slice(0, 500),
      quote: citation.quote,
      metadata: source.metadata,
    }];
  });
  const verified = citations.length > 0 || dataReferences.length > 0;
  return {
    answer: verified ? answer.answer : "I could not verify a supported answer from the indexed sources available in this workspace.",
    citations,
    data_references: [...dataReferences],
    verified,
  };
}

/** Internal diagnostic for logs only (never persisted or shown to users). */
function describeCause(error: unknown): string {
  const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(root instanceof Error)) return String(root).slice(0, 300);
  const code = "code" in root && typeof root.code === "string" ? ` [${root.code}]` : "";
  return `${root.name}${code}: ${root.message}`.slice(0, 300);
}

function describeCall(tool: RegisteredTool, input: unknown) {
  return `${tool.title}: ${JSON.stringify(input)}`.slice(0, 500);
}

const runContextSchema = z.object({ document_ids: z.array(z.guid()).max(50).optional() }).catch({});

/** Document IDs the task is limited to, or null for the whole workspace. */
export function documentScopeOf(run: Pick<AgentRunRecord, "context">): string[] | null {
  const ids = runContextSchema.parse(run.context ?? {}).document_ids;
  return ids?.length ? ids : null;
}

type StopReason = "cancelled" | "lease_lost" | "shutdown";

class RunStopped extends Error {
  constructor(readonly reason: StopReason) {
    super(`Run stopped: ${reason}`);
  }
}

/** Runs (or resumes) one claimed agent job until it completes, pauses for approval, fails, or is stopped. */
export async function executeAgentJob(job: ClaimedJob, workerId: string, shutdown: AbortSignal, baseLogger: Logger): Promise<AgentJobOutcome> {
  const log = baseLogger.child({ job_id: job.id, run_id: job.run_id, attempt: job.attempts });
  if (!job.run_id) {
    log.error("Agent job has no run ID");
    await finishAgentJob(job, workerId);
    return "skipped";
  }
  const run = await loadAgentRun(job.run_id);
  if (!run || TERMINAL_STATUSES.has(run.status) || run.status === "waiting_approval") {
    if (run?.status === "cancelled") await cancelAgentJob(job, workerId);
    else await finishAgentJob(job, workerId);
    log.info("Skipped job for a run that is not executable", { status: run?.status ?? "missing" });
    return "skipped";
  }

  // One controller aborts in-flight provider calls for any stop reason.
  const controller = new AbortController();
  let stopReason: StopReason | null = null;
  const stop = (reason: StopReason) => {
    if (stopReason) return;
    stopReason = reason;
    controller.abort();
  };
  const onShutdown = () => stop("shutdown");
  if (shutdown.aborted) onShutdown();
  shutdown.addEventListener("abort", onShutdown, { once: true });

  const heartbeat = setInterval(() => {
    void heartbeatAgentJob(job.id, workerId)
      .then(async (alive) => {
        if (alive) return;
        stop((await getRunStatus(run.id)) === "cancelled" ? "cancelled" : "lease_lost");
      })
      .catch((error: unknown) => log.warn("Agent job heartbeat failed", { error }));
  }, HEARTBEAT_INTERVAL_MS);

  const checkpoint = async () => {
    if (!stopReason && (await getRunStatus(run.id)) === "cancelled") stop("cancelled");
    if (stopReason) throw new RunStopped(stopReason);
  };

  try {
    return await runAgentLoop({ job, run, workerId, signal: controller.signal, checkpoint, log });
  } catch (error) {
    const reason: StopReason | null = error instanceof RunStopped ? error.reason : stopReason;
    if (reason === "cancelled") {
      await cancelOpenSteps(run.id);
      await cancelAgentJob(job, workerId);
      log.info("Run cancelled by user");
      return "cancelled";
    } else if (reason === "lease_lost") {
      log.warn("Lost the job lease; another worker may own the run now");
      return "lease_lost";
    } else if (reason === "shutdown") {
      await failInterruptedSteps(run.id, "Interrupted by worker shutdown; the run will resume.");
      await releaseAgentJob(job, workerId);
      log.info("Released run for another worker during shutdown");
      return "released";
    } else {
      const failure = classifyError(error);
      const retrying = shouldRetry(failure, job.attempts, job.max_attempts, getWorkerEnv().MAX_AGENT_RETRIES);
      await failInterruptedSteps(run.id, failure.message);
      await failAgentJob(job, workerId, failure, { retrying, delaySeconds: retrying ? retryDelaySeconds(job.attempts) : 0 });
      log.error("Agent run attempt failed", { error_code: failure.code, retrying, cause: describeCause(error) });
      return retrying ? "retrying" : "failed";
    }
  } finally {
    clearInterval(heartbeat);
    shutdown.removeEventListener("abort", onShutdown);
  }
}

async function runAgentLoop(context: {
  job: ClaimedJob; run: AgentRunRecord; workerId: string; signal: AbortSignal;
  checkpoint: () => Promise<void>; log: Logger;
}): Promise<"completed" | "paused_for_approval" | "skipped"> {
  const { job, run, workerId, signal, checkpoint, log } = context;
  const env = getWorkerEnv();
  const provider = getProvider("agent");
  const registry = getToolRegistry();
  const pricing = { inputPerMillion: env.LLM_INPUT_COST_PER_MILLION, outputPerMillion: env.LLM_OUTPUT_COST_PER_MILLION };
  const requestReserve = provider.isDemo ? 0 : maxRequestCostUsd(env.MAX_INPUT_TOKENS, env.MAX_OUTPUT_TOKENS, pricing);
  const attemptStarted = Date.now();

  const guardLimits = async () => {
    await checkpoint();
    if (Date.now() - attemptStarted > env.MAX_AGENT_DURATION_MS) {
      throw new AgentError("duration_limit_exceeded", "The run exceeded its configured duration limit.", false);
    }
    if (exceedsBudget(await getRunCost(run.id), requestReserve, env.MAX_AGENT_COST_USD)) {
      throw new AgentError("cost_limit_exceeded", "The run reached its configured estimated cost limit.", false);
    }
  };
  const attemptUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  /** Calls the provider, logs latency and usage (never content), and records usage against the run's budget. */
  const record = async <T>(operation: string, call: () => Promise<ProviderResult<T>>) => {
    const callStarted = performance.now();
    const response = await call();
    const costUsd = provider.isDemo ? 0 : estimateCostUsd(response.usage, pricing);
    attemptUsage.calls += 1;
    attemptUsage.inputTokens += response.usage.inputTokens;
    attemptUsage.outputTokens += response.usage.outputTokens;
    attemptUsage.costUsd += costUsd;
    log.info("Provider call", {
      operation, model: response.usage.model, duration_ms: Math.round(performance.now() - callStarted),
      input_tokens: response.usage.inputTokens, output_tokens: response.usage.outputTokens, estimated_cost_usd: Number(costUsd.toFixed(6)),
    });
    const total = await addRunUsage(run.id, { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, costUsd });
    if (total > env.MAX_AGENT_COST_USD) {
      throw new AgentError("cost_limit_exceeded", "The run exceeded its configured estimated cost limit.", false);
    }
    return response.value;
  };

  const documentScope = documentScopeOf(run);

  // Tools execute with the permissions of the run creator, re-read on every attempt.
  const actorRole = await getMemberRole(run.organization_id, run.created_by);
  if (!actorRole || !EXECUTING_ROLES.includes(actorRole)) {
    throw new AgentError("permission_denied", "The run creator no longer has permission to run agents in this organization.", false);
  }

  // Resume from persisted state. Steps left running by a crashed attempt are closed first.
  await failInterruptedSteps(run.id, "Interrupted before completion; resumed by a new attempt.");
  const state = buildResumeState(await loadRunSteps(run.id), registry);
  if (state.awaitingApproval) {
    await finishAgentJob(job, workerId);
    log.warn("Run still has an undecided approval; job released without executing");
    return "skipped";
  }
  const resumed = state.plan !== null;
  if (!(await beginAgentRun(run, { model: provider.model, attempt: job.attempts, resumed }))) {
    if ((await getRunStatus(run.id)) === "cancelled") throw new RunStopped("cancelled");
    await finishAgentJob(job, workerId);
    return "skipped";
  }
  log.info("Agent run started", { provider: provider.name, model: provider.model, resumed, actor_role: actorRole });

  const { evidence, dataReferences, completedSteps } = state;
  let toolStepsUsed = state.toolStepsUsed;
  let draft = state.draftAnswer ? { answer: state.draftAnswer, stepId: state.draftStepId } : null;
  const toolContext = (stepId: string, approval?: ToolContext["approval"]): ToolContext => ({
    run, actorRole, stepId, signal, evidence, dataReferences, approval, documentScope,
  });
  const remember = (tool: RegisteredTool | null, toolName: string, title: string, status: CompletedStep["status"], summary: string) => {
    completedSteps.push({ tool_name: tool?.name ?? toolName, title, status, summary });
  };

  /** Executes a tool on an already-started (running) step and records the result. */
  const executeTool = async (tool: RegisteredTool, stepId: string, input: unknown, approval?: ToolContext["approval"]) => {
    let output: unknown;
    try {
      output = await tool.run(input, toolContext(stepId, approval));
    } catch (error) {
      if (error instanceof ToolInputError) {
        await failStep(run.id, stepId, error.message);
        remember(tool, tool.name, tool.title, "failed", `Failed: ${error.message}`);
        return;
      }
      const failure = error instanceof AgentError ? error : new AgentError("tool_failed", `The ${tool.name} tool failed.`, true, { cause: error });
      await failStep(run.id, stepId, failure.message);
      throw failure;
    }
    // Persist before the cancellation checkpoint so a completed side effect is never left unrecorded.
    const summary = tool.summarize(output) ?? "Completed.";
    await completeStep(run.id, stepId, output, { toolName: tool.name, summary: { summary: summary.slice(0, 500) }, mergeAsResult: Boolean(approval) });
    addEvidence(evidence, tool.evidenceFrom(output));
    addDataReferences(dataReferences, tool.dataReferencesFrom(output, stepId));
    remember(tool, tool.name, tool.title, "completed", summary);
    await checkpoint();
  };

  // 1. Plan (only for fresh runs).
  let plan = state.plan;
  if (!plan) {
    await guardLimits();
    const documents = await listWorkspaceDocuments(run, documentScope);
    plan = await record("generate_plan", () => provider.generatePlan({ objective: run.objective, title: run.title, availableDocuments: documents.length }, { signal }));
    await checkpoint();
    await insertPlanStep(run, plan);
  }

  // 2. Execute an action approved while the run was paused. Input and permissions are revalidated first.
  if (state.pendingApproval) await executeApprovedStep(state.pendingApproval);

  // 3. Agent loop.
  const documents = await listWorkspaceDocuments(run, documentScope);
  while (!draft) {
    if (toolStepsUsed >= env.MAX_AGENT_STEPS) {
      throw new AgentError("step_limit_exceeded", `The agent reached the ${env.MAX_AGENT_STEPS}-step limit without a final answer.`, false);
    }
    await guardLimits();
    const action = validateAction(await record("execute_step", () => provider.executeStep({
      objective: run.objective, plan, stepIndex: toolStepsUsed, maxSteps: env.MAX_AGENT_STEPS,
      completedSteps, evidence, tools: registry.specs(), documents,
    }, { signal })));
    await checkpoint();

    if (action.type === "final_answer") {
      const stepId = await startStep(run, { type: "analysis", title: "Draft final answer", description: "Prepare a concise answer grounded in retrieved evidence.", input: { evidence_count: evidence.length, data_reference_count: dataReferences.length } });
      await completeStep(run.id, stepId, { draft: action.answer });
      draft = { answer: action.answer, stepId };
      break;
    }

    toolStepsUsed += 1;
    const paused = await handleToolCall(action);
    if (paused) return "paused_for_approval";
  }

  // 4. Final answer with citation verification.
  await guardLimits();
  const finalStepId = await startStep(run, { type: "final", title: "Final answer", description: "Sourced response for the requested task.", input: { draft_step_id: draft.stepId, evidence_count: evidence.length } });
  const finalAnswer = validateCitations(
    await record("generate_final_answer", () => provider.generateFinalAnswer({ objective: run.objective, draftAnswer: draft.answer, evidence, completedSteps }, { signal })),
    evidence,
    dataReferences,
  );
  await checkpoint();
  await completeStep(run.id, finalStepId, finalAnswer, { summary: { citation_count: finalAnswer.citations.length, verified: finalAnswer.verified } });
  await finishAgentRun(job, workerId, finalAnswer);
  log.info("Agent run completed", {
    citations: finalAnswer.citations.length, data_references: dataReferences.length, tool_steps: toolStepsUsed,
    attempt_duration_ms: Date.now() - attemptStarted, provider_calls: attemptUsage.calls,
    input_tokens: attemptUsage.inputTokens, output_tokens: attemptUsage.outputTokens,
    estimated_cost_usd: Number(attemptUsage.costUsd.toFixed(6)),
  });
  return "completed";

  /** Returns true when the run paused for approval. */
  async function handleToolCall(action: Extract<ValidatedAction, { type: "tool_call" }>): Promise<boolean> {
    const tool = registry.get(action.toolName);
    const title = (tool?.title ?? `Unknown tool: ${action.toolName}`).slice(0, 160);
    const reject = async (error: string, input: unknown = null) => {
      await recordRejectedToolCall(run, { title, toolName: action.toolName.slice(0, 80), input, error });
      remember(tool, action.toolName, title, "failed", `Failed: ${error}`);
      return false;
    };
    if (!tool) return reject(`Unknown tool "${action.toolName}". Available tools: ${registry.names().join(", ")}.`);

    let args: unknown;
    try {
      args = JSON.parse(action.argumentsJson);
    } catch {
      return reject("arguments_json is not valid JSON.");
    }
    const validation = tool.validateInput(args);
    if (!validation.success) return reject(`Invalid arguments: ${validation.error}`, args);
    if (!tool.allowedRoles.includes(actorRole!)) {
      return reject(`The run creator's role (${actorRole}) is not permitted to use ${tool.name}.`, validation.data);
    }

    // Approval is decided by the registry, never by the model's choice of action type.
    if (tool.requiresApproval) {
      let approval;
      try {
        approval = tool.describeApproval(validation.data, toolContext("pending"));
      } catch (error) {
        if (error instanceof ToolInputError) return reject(error.message, validation.data);
        throw error;
      }
      await checkpoint();
      const stepId = await requestApproval(job, workerId, run, { toolName: tool.name, title, input: validation.data, approval });
      log.info("Run paused for approval", { step_id: stepId, tool_name: tool.name });
      return true;
    }

    const stepId = await startStep(run, { type: tool.stepType, title, description: describeCall(tool, validation.data), toolName: tool.name, input: validation.data });
    await executeTool(tool, stepId, validation.data);
    return false;
  }

  async function executeApprovedStep(step: PersistedStep) {
    const tool = step.tool_name ? registry.get(step.tool_name) : null;
    if (!(await startApprovedStep(run.id, step.id, step.tool_name ?? "unknown"))) throw new RunStopped("lease_lost");
    if (!tool || !tool.requiresApproval || !step.approved_by || !step.approved_at) {
      await failStep(run.id, step.id, "The approved action is not a registered approval-required tool; it was not executed.");
      remember(tool, step.tool_name ?? "unknown", step.title, "failed", "Failed: the approved action could not be executed.");
      return;
    }
    // Never trust stored input blindly: revalidate it with the tool's current schema.
    const validation = tool.validateInput(step.input_json);
    if (!validation.success) {
      await failStep(run.id, step.id, `The approved input failed revalidation (${validation.error}); the action was not executed.`);
      remember(tool, tool.name, step.title, "failed", "Failed: the approved input failed revalidation.");
      return;
    }
    if (!tool.allowedRoles.includes(actorRole!)) {
      await failStep(run.id, step.id, "The run creator is no longer permitted to use this tool; the action was not executed.");
      remember(tool, tool.name, step.title, "failed", "Failed: permission was revoked before execution.");
      return;
    }
    log.info("Executing approved action", { step_id: step.id, tool_name: tool.name, approved_by: step.approved_by });
    await executeTool(tool, step.id, validation.data, { approvedBy: step.approved_by, approvedAt: step.approved_at });
  }
}
