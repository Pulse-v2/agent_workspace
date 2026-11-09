import { ApiError, ok, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

type Params = { params: Promise<{ id: string }> };

/** POST /api/documents/[id]/retry — re-queues a failed document (admins and members). */
export const POST = withAuth(async ({ supabase }, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const { error } = await supabase.rpc("retry_document_processing", { p_document_id: id });
  if (error) {
    if (error.code === "42501") throw new ApiError("forbidden", "You cannot retry this document.");
    if (error.code === "22023") throw new ApiError("conflict", "Only failed documents can be retried.");
    throw new ApiError("internal_error", "The document could not be re-queued.");
  }
  return ok({ id, processing_status: "queued" });
});
