import { countPendingApprovals } from "@/features/agent-runs/queries";
import type { AppContext } from "@/features/app/context";

const DAYS = 14;
const RUN_SAMPLE_LIMIT = 1000;

export type DailyRuns = { date: string; label: string; completed: number; failed: number; other: number };

/**
 * Dashboard figures computed from runs visible to the user (RLS: admins see all
 * runs in the organization, members their own, viewers completed runs).
 */
export async function getDashboardData(context: AppContext) {
  const orgId = context.organization.id;
  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const [runsResult, pendingApprovals, documents, artifacts, eventsResult] = await Promise.all([
    context.supabase.from("agent_runs")
      .select("id, title, status, workspace_id, model, input_tokens, output_tokens, estimated_cost_usd, created_at, started_at, finished_at, retry_count, created_by, error_code, context")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(RUN_SAMPLE_LIMIT),
    countPendingApprovals(context),
    context.supabase.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    context.supabase.from("artifacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    context.supabase.from("agent_run_events").select("id, run_id, event_type, payload, created_at")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(12),
  ]);
  const runs = runsResult.data ?? [];

  const daily = new Map<string, DailyRuns>();
  for (let offset = 0; offset < DAYS; offset += 1) {
    const day = new Date(since.getTime() + offset * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    daily.set(key, { date: key, label: day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), completed: 0, failed: 0, other: 0 });
  }
  for (const run of runs) {
    const bucket = daily.get(run.created_at.slice(0, 10));
    if (!bucket) continue;
    if (run.status === "completed") bucket.completed += 1;
    else if (run.status === "failed") bucket.failed += 1;
    else bucket.other += 1;
  }

  const runTitles = new Map(runs.map((run) => [run.id, run.title]));
  const missing = [...new Set((eventsResult.data ?? []).map((event) => event.run_id).filter((id) => !runTitles.has(id)))];
  if (missing.length) {
    const { data } = await context.supabase.from("agent_runs").select("id, title").in("id", missing);
    for (const run of data ?? []) runTitles.set(run.id, run.title);
  }

  return {
    stats: {
      totalRuns: runs.length,
      completed: runs.filter((run) => run.status === "completed").length,
      failed: runs.filter((run) => run.status === "failed").length,
      active: runs.filter((run) => ["queued", "planning", "running"].includes(run.status)).length,
      pendingApprovals,
      inputTokens: runs.reduce((total, run) => total + run.input_tokens, 0),
      outputTokens: runs.reduce((total, run) => total + run.output_tokens, 0),
      estimatedCostUsd: runs.reduce((total, run) => total + Number(run.estimated_cost_usd), 0),
      documents: documents.count ?? 0,
      artifacts: artifacts.count ?? 0,
      truncated: runs.length === RUN_SAMPLE_LIMIT,
    },
    daily: [...daily.values()],
    recentRuns: runs.slice(0, 6),
    activity: (eventsResult.data ?? []).map((event) => ({ ...event, runTitle: runTitles.get(event.run_id) ?? "Agent run" })),
  };
}
