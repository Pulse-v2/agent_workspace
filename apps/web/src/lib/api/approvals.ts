import { z } from "zod";
import { ApiError, ok, readJson, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

const decisionBodySchema = z.object({
  reason: z.string().trim().max(1000).optional(),
}).strict();

type Params = { params: Promise<{ id: string; stepId: string }> };

/**
 * Shared handler for approve/reject. All checks run inside
 * decide_agent_run_approval(): the caller's role, that the step belongs to the
 * run and requires approval, and that it is still pending (row locks prevent
 * double decisions). The pending action itself is read from the database by
 * the worker and revalidated before execution; nothing from this request
 * is executed.
 */
export function decisionHandler(decision: "approved" | "rejected") {
  return withAuth(async ({ supabase }, request: Request, { params }: Params) => {
    const { id, stepId } = await params;
    const runId = idParamSchema.parse(id);
    const parsedStepId = idParamSchema.parse(stepId);
    const hasBody = (request.headers.get("content-length") ?? "0") !== "0";
    const body = decisionBodySchema.parse(hasBody ? await readJson(request) : {});

    const { error } = await supabase.rpc("decide_agent_run_approval", {
      p_run_id: runId,
      p_step_id: parsedStepId,
      p_decision: decision,
      p_reason: body.reason,
    });
    if (error) {
      if (error.code === "42501") throw new ApiError("forbidden", "This action does not exist or you are not allowed to decide it.");
      if (error.code === "55000") throw new ApiError("conflict", "This action has already been decided or is no longer pending.");
      if (error.code === "22023") throw new ApiError("bad_request", "The decision is invalid.");
      throw new ApiError("internal_error", "The decision could not be saved.");
    }
    return ok({ run_id: runId, step_id: parsedStepId, decision, run_status: "queued" });
  });
}
