import type { AgentRunEventType, ClaimedJob, OrganizationRole } from "@ai-agent/shared";
import type { AgentFailure } from "../agent/errors.js";
import type { PersistedStep } from "../agent/state.js";
import type { AgentPlan } from "../providers/types.js";
import type { ApprovalRequest } from "../tools/types.js";
import { getDatabase, jsonParameter } from "./database.js";

export type AgentRunRecord = {
  id: string; organization_id: string; workspace_id: string; title: string; objective: string;
  status: string; model: string | null; input_tokens: number; output_tokens: number;
  estimated_cost_usd: string; retry_count: number; created_by: string;
  /** Task context chosen at creation (e.g. { document_ids }), validated by the API. */
  context: unknown;
};

export type StepType = "planning" | "retrieval" | "tool" | "analysis" | "final";

export async function claimAgentJobs(workerId: string, limit = 1): Promise<ClaimedJob[]> {
  return getDatabase()<ClaimedJob[]>`select * from private.claim_agent_jobs(${workerId}, ${limit})`;
}

export async function heartbeatAgentJob(jobId: string, workerId: string) {
  const [row] = await getDatabase()<Array<{ heartbeat_agent_job: boolean }>>`select private.heartbeat_agent_job(${jobId}, ${workerId})`;
  return row?.heartbeat_agent_job ?? false;
}

export async function loadAgentRun(runId: string) {
  const [run] = await getDatabase()<AgentRunRecord[]>`
    select id, organization_id, workspace_id, title, objective, status, model,
      input_tokens, output_tokens, estimated_cost_usd, retry_count, created_by, context
    from public.agent_runs where id = ${runId}
  `;
  return run ?? null;
}

export async function getRunStatus(runId: string) {
  const [run] = await getDatabase()<Array<{ status: string }>>`select status from public.agent_runs where id = ${runId}`;
  return run?.status ?? null;
}

export async function getRunCost(runId: string) {
  const [row] = await getDatabase()<Array<{ estimated_cost_usd: string }>>`select estimated_cost_usd from public.agent_runs where id = ${runId}`;
  return Number(row?.estimated_cost_usd ?? 0);
}

export async function countIndexedDocuments(workspaceId: string) {
  const [row] = await getDatabase()<Array<{ count: number }>>`
    select count(*)::integer as count from public.documents where workspace_id = ${workspaceId} and processing_status = 'indexed'
  `;
  return row?.count ?? 0;
}

export async function appendRunEvent(runId: string, type: AgentRunEventType, payload: Record<string, unknown> = {}) {
  const sql = getDatabase();
  await sql`select private.append_agent_run_event(${runId}, ${type}, ${sql.json(jsonParameter(payload))})`;
}

export async function loadRunSteps(runId: string): Promise<PersistedStep[]> {
  return getDatabase()<PersistedStep[]>`
    select id, step_index, step_type, title, status, tool_name, input_json, output_json,
      requires_approval, approved_by, approved_at::text as approved_at, error_message
    from public.agent_run_steps where run_id = ${runId} order by step_index
  `;
}

/** Current role of a user in the organization, or null if they are no longer a member. */
export async function getMemberRole(organizationId: string, userId: string): Promise<OrganizationRole | null> {
  const [row] = await getDatabase()<Array<{ role: OrganizationRole }>>`
    select role from public.organization_members where organization_id = ${organizationId} and user_id = ${userId}
  `;
  return row?.role ?? null;
}

/**
 * Steps left "running" by a crashed or interrupted attempt are marked failed so
 * the timeline stays truthful; the resumed attempt continues after them.
 * An approved action that was executing goes back to "approved" so it is
 * re-executed (tool execution is idempotent per step).
 */
export async function failInterruptedSteps(runId: string, reason: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    await transaction`
      update public.agent_run_steps set status = 'approved', started_at = null
      where run_id = ${runId} and status = 'running' and requires_approval and approved_by is not null
    `;
    const interrupted = await transaction<Array<{ id: string; title: string }>>`
      update public.agent_run_steps set status = 'failed', error_message = ${reason}, finished_at = now()
      where run_id = ${runId} and status = 'running' returning id, title
    `;
    for (const step of interrupted) {
      await transaction`select private.append_agent_run_event(${runId}, 'step_failed', ${transaction.json({ step_id: step.id, title: step.title, error: reason })})`;
    }
  });
}

/** Moves the run into planning (fresh) or running (resumed with an existing plan). Returns false if the run is no longer active. */
export async function beginAgentRun(run: AgentRunRecord, input: { model: string; attempt: number; resumed: boolean }) {
  const sql = getDatabase();
  const status = input.resumed ? "running" : "planning";
  return sql.begin(async (transaction) => {
    const active = await transaction`
      update public.agent_runs set status = ${status}, model = ${input.model}, started_at = coalesce(started_at, now()),
        finished_at = null, error_code = null, error_message = null
      where id = ${run.id} and status in ('queued', 'planning', 'running') returning id
    `;
    if (!active.length) return false;
    await transaction`select private.append_agent_run_event(${run.id}, 'run_started', ${transaction.json({ status, model: input.model, attempt: input.attempt, resumed: input.resumed })})`;
    return true;
  });
}

export async function insertPlanStep(run: AgentRunRecord, plan: AgentPlan) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [row] = await transaction<Array<{ id: string }>>`
      insert into public.agent_run_steps (run_id, organization_id, workspace_id, step_index, step_type, title, description, status, output_json, started_at, finished_at)
      select ${run.id}, ${run.organization_id}, ${run.workspace_id}, coalesce(max(step_index), -1) + 1, 'planning', 'Create execution plan',
        ${plan.summary}, 'completed', ${transaction.json(jsonParameter(plan))}, now(), now()
      from public.agent_run_steps where run_id = ${run.id}
      returning id
    `;
    await transaction`update public.agent_runs set status = 'running' where id = ${run.id} and status = 'planning'`;
    await transaction`select private.append_agent_run_event(${run.id}, 'plan_created', ${transaction.json(jsonParameter({ step_id: row!.id, summary: plan.summary, steps: plan.steps }))})`;
    return row!.id;
  });
}

/** Inserts a running step at the next index and emits step_started (and tool_call_started for tools) atomically. */
export async function startStep(run: AgentRunRecord, input: {
  type: StepType; title: string; description: string; toolName?: string | null; input?: unknown;
}) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [row] = await transaction<Array<{ id: string; step_index: number }>>`
      insert into public.agent_run_steps (run_id, organization_id, workspace_id, step_index, step_type, title, description, status, tool_name, input_json, started_at)
      select ${run.id}, ${run.organization_id}, ${run.workspace_id}, coalesce(max(step_index), -1) + 1, ${input.type}, ${input.title},
        ${input.description}, 'running', ${input.toolName ?? null}, ${transaction.json(jsonParameter(input.input ?? null))}, now()
      from public.agent_run_steps where run_id = ${run.id}
      returning id, step_index
    `;
    const stepId = row!.id;
    await transaction`select private.append_agent_run_event(${run.id}, 'step_started', ${transaction.json({ step_id: stepId, step_index: row!.step_index, step_type: input.type, title: input.title })})`;
    if (input.toolName) {
      await transaction`select private.append_agent_run_event(${run.id}, 'tool_call_started', ${transaction.json(jsonParameter({ step_id: stepId, tool_name: input.toolName, input: input.input ?? null }))})`;
    }
    return stepId;
  });
}

export async function completeStep(runId: string, stepId: string, output: unknown, event: {
  toolName?: string; summary?: Record<string, unknown>; mergeAsResult?: boolean;
} = {}) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const value = transaction.json(jsonParameter(event.mergeAsResult ? { result: output } : output));
    const updated = event.mergeAsResult
      ? await transaction`update public.agent_run_steps set status = 'completed', output_json = coalesce(output_json, '{}'::jsonb) || ${value}, finished_at = now() where id = ${stepId} and status = 'running' returning id`
      : await transaction`update public.agent_run_steps set status = 'completed', output_json = ${value}, finished_at = now() where id = ${stepId} and status = 'running' returning id`;
    if (!updated.length) return;
    if (event.toolName) {
      await transaction`select private.append_agent_run_event(${runId}, 'tool_call_completed', ${transaction.json(jsonParameter({ step_id: stepId, tool_name: event.toolName, ...event.summary }))})`;
    }
    await transaction`select private.append_agent_run_event(${runId}, 'step_completed', ${transaction.json(jsonParameter({ step_id: stepId, ...event.summary }))})`;
  });
}

export async function failStep(runId: string, stepId: string, message: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const failed = await transaction`update public.agent_run_steps set status = 'failed', error_message = ${message}, finished_at = now() where id = ${stepId} and status = 'running' returning id`;
    if (failed.length) await transaction`select private.append_agent_run_event(${runId}, 'step_failed', ${transaction.json({ step_id: stepId, error: message })})`;
  });
}

/** Steps created by the worker after a user cancelled (race between checkpoint and insert) are closed as cancelled. */
export async function cancelOpenSteps(runId: string) {
  await getDatabase()`update public.agent_run_steps set status = 'cancelled', finished_at = now() where run_id = ${runId} and status in ('queued', 'running')`;
}

/** Records a tool call that was rejected before execution (unknown tool, invalid arguments, not permitted). */
export async function recordRejectedToolCall(run: AgentRunRecord, input: { title: string; toolName: string | null; input: unknown; error: string }) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [row] = await transaction<Array<{ id: string; step_index: number }>>`
      insert into public.agent_run_steps (run_id, organization_id, workspace_id, step_index, step_type, title, description, status, tool_name, input_json, error_message, started_at, finished_at)
      select ${run.id}, ${run.organization_id}, ${run.workspace_id}, coalesce(max(step_index), -1) + 1, 'tool', ${input.title},
        'The tool call was not executed.', 'failed', ${input.toolName}, ${transaction.json(jsonParameter(input.input ?? null))}, ${input.error}, now(), now()
      from public.agent_run_steps where run_id = ${run.id}
      returning id, step_index
    `;
    await transaction`select private.append_agent_run_event(${run.id}, 'step_started', ${transaction.json({ step_id: row!.id, step_index: row!.step_index, step_type: "tool", title: input.title })})`;
    await transaction`select private.append_agent_run_event(${run.id}, 'step_failed', ${transaction.json({ step_id: row!.id, tool_name: input.toolName, error: input.error })})`;
  });
}

/**
 * Persists an approval-required action and pauses the run in one transaction:
 * the pending step (with its validated input and approval preview), the run
 * status, the approval_requested event, and the job completion.
 */
export async function requestApproval(job: ClaimedJob, workerId: string, run: AgentRunRecord, input: {
  toolName: string; title: string; input: unknown; approval: ApprovalRequest;
}) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [row] = await transaction<Array<{ id: string; step_index: number }>>`
      insert into public.agent_run_steps (run_id, organization_id, workspace_id, step_index, step_type, title, description, status, tool_name, input_json, output_json, requires_approval, started_at)
      select ${run.id}, ${run.organization_id}, ${run.workspace_id}, coalesce(max(step_index), -1) + 1, 'tool', ${input.title},
        ${input.approval.action}, 'waiting_approval', ${input.toolName}, ${transaction.json(jsonParameter(input.input))},
        ${transaction.json(jsonParameter({ approval: input.approval }))}, true, now()
      from public.agent_run_steps where run_id = ${run.id}
      returning id, step_index
    `;
    const stepId = row!.id;
    const paused = await transaction`update public.agent_runs set status = 'waiting_approval' where id = ${run.id} and status = 'running' returning id`;
    if (!paused.length) throw new Error("Run is no longer running; approval was not requested.");
    await transaction`select private.append_agent_run_event(${run.id}, 'step_started', ${transaction.json({ step_id: stepId, step_index: row!.step_index, step_type: "tool", title: input.title })})`;
    await transaction`select private.append_agent_run_event(${run.id}, 'approval_requested', ${transaction.json(jsonParameter({
      step_id: stepId, tool_name: input.toolName, action: input.approval.action, title: input.approval.title, expected_effect: input.approval.expected_effect,
    }))})`;
    await transaction`update private.job_queue set status = 'completed', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = ${job.id} and locked_by = ${workerId}`;
    return stepId;
  });
}

/** Moves an approved step to running (once). Returns false if it was already taken or is no longer approved. */
export async function startApprovedStep(runId: string, stepId: string, toolName: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const started = await transaction`
      update public.agent_run_steps set status = 'running', started_at = now()
      where id = ${stepId} and run_id = ${runId} and status = 'approved' and requires_approval and approved_by is not null
      returning id
    `;
    if (!started.length) return false;
    await transaction`select private.append_agent_run_event(${runId}, 'tool_call_started', ${transaction.json({ step_id: stepId, tool_name: toolName, approved: true })})`;
    return true;
  });
}

/** Adds usage and returns the new cumulative estimated cost. */
export async function addRunUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costUsd: number }) {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return getRunCost(runId);
  const [row] = await getDatabase()<Array<{ estimated_cost_usd: string }>>`
    update public.agent_runs set input_tokens = input_tokens + ${usage.inputTokens}, output_tokens = output_tokens + ${usage.outputTokens},
      estimated_cost_usd = estimated_cost_usd + ${usage.costUsd}
    where id = ${runId} returning estimated_cost_usd
  `;
  return Number(row?.estimated_cost_usd ?? 0);
}

export async function finishAgentRun(job: ClaimedJob, workerId: string, result: unknown) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const completed = await transaction`update public.agent_runs set status = 'completed', finished_at = now(), error_code = null, error_message = null where id = ${job.run_id} and status = 'running' returning id`;
    if (completed.length) await transaction`select private.append_agent_run_event(${job.run_id}, 'run_completed', ${transaction.json(jsonParameter({ status: "completed", result }))})`;
    await transaction`update private.job_queue set status = 'completed', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = ${job.id} and locked_by = ${workerId}`;
  });
}

/** Completes the job without touching the run (terminal run, or run paused for approval). */
export async function finishAgentJob(job: ClaimedJob, workerId: string) {
  await getDatabase()`update private.job_queue set status = 'completed', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = ${job.id} and locked_by = ${workerId}`;
}

export async function cancelAgentJob(job: ClaimedJob, workerId: string) {
  await getDatabase()`update private.job_queue set status = 'cancelled', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = ${job.id} and locked_by = ${workerId}`;
}

/**
 * Graceful shutdown: hands the job back without consuming an attempt so another
 * worker resumes it immediately from the persisted steps.
 */
export async function releaseAgentJob(job: ClaimedJob, workerId: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const released = await transaction`
      update private.job_queue set status = 'queued', attempts = greatest(attempts - 1, 0), available_at = now(),
        locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now()
      where id = ${job.id} and locked_by = ${workerId} returning id
    `;
    if (released.length) {
      await transaction`update public.agent_runs set status = 'queued' where id = ${job.run_id} and status in ('planning', 'running')`;
    }
  });
}

export async function failAgentJob(job: ClaimedJob, workerId: string, failure: AgentFailure, retry: { retrying: boolean; delaySeconds: number }) {
  const sql = getDatabase();
  const message = failure.message.slice(0, 1000);
  await sql.begin(async (transaction) => {
    const owned = await transaction`
      update private.job_queue set status = ${retry.retrying ? "queued" : "failed"},
        available_at = now() + make_interval(secs => ${retry.delaySeconds}::double precision),
        locked_at = null, locked_by = null, lease_expires_at = null,
        last_error = ${`${failure.code}: ${message}`}, updated_at = now()
      where id = ${job.id} and locked_by = ${workerId} returning id
    `;
    // Lost the lease meanwhile: another worker owns the run now.
    if (!owned.length) return;
    const updated = await transaction`
      update public.agent_runs set status = ${retry.retrying ? "queued" : "failed"},
        retry_count = retry_count + ${retry.retrying ? 1 : 0},
        finished_at = case when ${retry.retrying} then null else now() end,
        error_code = ${failure.code}, error_message = ${message}
      where id = ${job.run_id} and status in ('queued', 'planning', 'running') returning id
    `;
    if (updated.length) {
      await transaction`select private.append_agent_run_event(${job.run_id}, ${retry.retrying ? "run_retrying" : "run_failed"}, ${transaction.json({
        error_code: failure.code, error: message, retrying: retry.retrying, attempt: job.attempts, retry_in_seconds: retry.retrying ? retry.delaySeconds : null,
      })})`;
    }
  });
}
