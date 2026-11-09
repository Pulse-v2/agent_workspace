import { ApiError, ok, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-runs/[id]/cancel — cancels an active run. Authorization and the
 * state transition happen atomically in cancel_agent_run(); the worker observes
 * the cancellation at its next checkpoint or heartbeat and aborts provider calls.
 */
export const POST = withAuth(async ({ supabase }, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const { error } = await supabase.rpc("cancel_agent_run", { p_run_id: id });
  if (error) {
    if (error.code === "42501") throw new ApiError("not_found", "Run not found or you cannot cancel it.");
    if (error.code === "22023") throw new ApiError("conflict", "The run is no longer active.");
    throw new ApiError("internal_error", "The run could not be cancelled.");
  }
  return ok({ id, status: "cancelled" });
});
