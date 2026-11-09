import { z } from "zod";
import type { AppContext } from "@/features/app/context";

const num = z.coerce.number().catch(0);
const nullableNum = z.coerce.number().nullable().catch(null);

export const usageSummarySchema = z.object({
  days: num,
  totals: z.object({
    runs: num, completed: num, failed: num, cancelled: num, active: num, demo_runs: num,
    input_tokens: num, output_tokens: num, estimated_cost_usd: num, retries: num, avg_duration_seconds: nullableNum,
  }),
  daily: z.array(z.object({ day: z.string(), runs: num, input_tokens: num, output_tokens: num, estimated_cost_usd: num })).catch([]),
  by_model: z.array(z.object({ model: z.string(), runs: num, tokens: num, estimated_cost_usd: num })).catch([]),
  by_workspace: z.array(z.object({ workspace_id: z.string(), runs: num, tokens: num, estimated_cost_usd: num })).catch([]),
  tools: z.array(z.object({ tool_name: z.string(), calls: num, failed: num, rejected: num, avg_duration_ms: nullableNum })).catch([]),
  failures: z.array(z.object({ error_code: z.string(), runs: num })).catch([]),
  top_runs: z.array(z.object({
    id: z.string(), title: z.string(), status: z.string(), model: z.string().nullable(), tokens: num, estimated_cost_usd: num, created_at: z.string(),
  })).catch([]),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const queueStatusSchema = z.object({
  agent_runs_queued: num, agent_runs_running: num, documents_queued: num, documents_running: num,
  oldest_queued_seconds: nullableNum, workers_online: num, last_worker_heartbeat_at: z.string().nullable().catch(null),
});
export type QueueStatus = z.infer<typeof queueStatusSchema>;

export const USAGE_PERIODS = [7, 30, 90] as const;

/** Aggregated by the database over rows the user can read (RLS), so members see only their own runs. */
export async function getUsageSummary(context: AppContext, days: number): Promise<UsageSummary | null> {
  const { data, error } = await context.supabase.rpc("usage_summary", { p_organization_id: context.organization.id, p_days: days });
  if (error) return null;
  const parsed = usageSummarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function getQueueStatus(context: AppContext): Promise<QueueStatus | null> {
  const { data, error } = await context.supabase.rpc("queue_status", { p_organization_id: context.organization.id });
  if (error) return null;
  const parsed = queueStatusSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
