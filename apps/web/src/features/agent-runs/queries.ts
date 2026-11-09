import type { AgentRunStatus } from "@ai-agent/shared";
import { canApproveRun, type AppContext } from "@/features/app/context";
import type { Tables } from "@/lib/supabase/database.types";

export type RunRow = Pick<Tables<"agent_runs">,
  "id" | "workspace_id" | "created_by" | "title" | "status" | "model" | "input_tokens" | "output_tokens" |
  "estimated_cost_usd" | "retry_count" | "error_code" | "started_at" | "finished_at" | "created_at" | "context">;

export const RUN_LIST_COLUMNS = "id, workspace_id, created_by, title, status, model, input_tokens, output_tokens, estimated_cost_usd, retry_count, error_code, started_at, finished_at, created_at, context";

/** Runs visible to the user in the current organization (RLS decides which ones). */
export async function listRuns(context: AppContext, options: { workspaceId?: string; status?: AgentRunStatus; q?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? 20;
  let query = context.supabase.from("agent_runs").select(RUN_LIST_COLUMNS, { count: "exact" })
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (options.workspaceId) query = query.eq("workspace_id", options.workspaceId);
  if (options.status) query = query.eq("status", options.status);
  if (options.q) query = query.ilike("title", `%${options.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
  const { data, count, error } = await query;
  if (error) throw new Error("Runs could not be loaded.");
  return { rows: (data ?? []) as RunRow[], total: count ?? 0, page, pageSize };
}

export async function getRunDetail(context: AppContext, runId: string) {
  const { data: run } = await context.supabase.from("agent_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return null;
  const [steps, events] = await Promise.all([
    context.supabase.from("agent_run_steps").select("*").eq("run_id", runId).order("step_index"),
    context.supabase.from("agent_run_events").select("id, sequence, event_type, payload, created_at").eq("run_id", runId).order("sequence"),
  ]);
  return { ...run, steps: steps.data ?? [], events: events.data ?? [] };
}
export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;

export type PendingApproval = {
  step: Pick<Tables<"agent_run_steps">, "id" | "title" | "tool_name" | "output_json" | "input_json" | "created_at">;
  run: Pick<Tables<"agent_runs">, "id" | "title" | "workspace_id" | "created_by" | "created_at">;
};

/** Pending actions in the current organization that this user may decide. */
export async function listPendingApprovals(context: AppContext): Promise<PendingApproval[]> {
  const { data: runs } = await context.supabase.from("agent_runs")
    .select("id, title, workspace_id, created_by, created_at")
    .eq("organization_id", context.organization.id).eq("status", "waiting_approval")
    .order("created_at", { ascending: false }).limit(100);
  const approvable = (runs ?? []).filter((run) => canApproveRun(context, run.created_by));
  if (!approvable.length) return [];
  const { data: steps } = await context.supabase.from("agent_run_steps")
    .select("id, run_id, title, tool_name, output_json, input_json, created_at")
    .in("run_id", approvable.map((run) => run.id)).eq("status", "waiting_approval").eq("requires_approval", true)
    .order("created_at", { ascending: false });
  return (steps ?? []).flatMap((step) => {
    const run = approvable.find((item) => item.id === step.run_id);
    return run ? [{ step, run }] : [];
  });
}

export async function countPendingApprovals(context: AppContext) {
  const { data } = await context.supabase.from("agent_runs").select("created_by")
    .eq("organization_id", context.organization.id).eq("status", "waiting_approval").limit(500);
  return (data ?? []).filter((run) => canApproveRun(context, run.created_by)).length;
}
