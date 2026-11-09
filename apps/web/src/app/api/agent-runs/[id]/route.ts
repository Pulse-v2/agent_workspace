import { ApiError, fromPostgrestError, ok, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

type Params = { params: Promise<{ id: string }> };

/** GET /api/agent-runs/[id] — run details with ordered steps and events. Access is enforced by RLS (can_read_agent_run). */
export const GET = withAuth(async ({ supabase }, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);

  const { data: run, error } = await supabase.from("agent_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw fromPostgrestError(error, "The run could not be loaded.");
  if (!run) throw new ApiError("not_found", "Run not found.");

  const [steps, events] = await Promise.all([
    supabase.from("agent_run_steps").select("*").eq("run_id", id).order("step_index"),
    supabase.from("agent_run_events").select("id, sequence, event_type, payload, created_at").eq("run_id", id).order("sequence"),
  ]);
  if (steps.error) throw fromPostgrestError(steps.error, "Run steps could not be loaded.");
  if (events.error) throw fromPostgrestError(events.error, "Run events could not be loaded.");

  return ok({ ...run, steps: steps.data, events: events.data });
});
