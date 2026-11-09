import { ApiError, fromPostgrestError, ok, pageRange, readJson, withAuth } from "@/lib/api/http";
import { createAgentRunSchema, listAgentRunsQuerySchema } from "@/lib/validations/agent-runs";

const RUN_LIST_COLUMNS = "id, organization_id, workspace_id, created_by, title, status, model, input_tokens, output_tokens, estimated_cost_usd, retry_count, error_code, started_at, finished_at, created_at, updated_at";

/** GET /api/agent-runs?workspaceId=&status=&page=&pageSize= — runs visible to the user (RLS-scoped). */
export const GET = withAuth(async ({ supabase }, request: Request) => {
  const query = listAgentRunsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { from, to } = pageRange(query);
  let builder = supabase.from("agent_runs").select(RUN_LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (query.workspaceId) builder = builder.eq("workspace_id", query.workspaceId);
  if (query.status) builder = builder.eq("status", query.status);
  const { data, error, count } = await builder;
  if (error) throw fromPostgrestError(error, "Runs could not be loaded.");
  return ok(data, { meta: { page: query.page, pageSize: query.pageSize, total: count ?? 0 } });
});

/**
 * POST /api/agent-runs — queues a new run. The organization is derived from the
 * workspace the user can read, never taken from the client. Inserting the run
 * enqueues its job and first event in the same transaction (database trigger);
 * the worker executes it independently of this request.
 */
export const POST = withAuth(async ({ supabase, user }, request: Request) => {
  const input = createAgentRunSchema.parse(await readJson(request));

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces").select("id, organization_id").eq("id", input.workspaceId).maybeSingle();
  if (workspaceError) throw fromPostgrestError(workspaceError);
  if (!workspace) throw new ApiError("not_found", "Workspace not found.");

  const { data: canRun, error: roleError } = await supabase.rpc("has_org_role", {
    p_organization_id: workspace.organization_id, p_roles: ["admin", "member"],
  });
  if (roleError) throw fromPostgrestError(roleError);
  if (!canRun) throw new ApiError("forbidden", "Viewers cannot start agent runs.");

  // Selected documents must belong to this workspace; the worker enforces the scope during execution.
  const documentIds = [...new Set(input.documentIds)];
  if (documentIds.length) {
    const { data: documents, error: documentsError } = await supabase.from("documents").select("id")
      .eq("workspace_id", workspace.id).in("id", documentIds);
    if (documentsError) throw fromPostgrestError(documentsError);
    if (documents.length !== documentIds.length) throw new ApiError("bad_request", "Some selected documents are not in this workspace.");
  }

  // The ID is generated here and the insert has no RETURNING: the SELECT policy
  // (can_read_agent_run) looks the row up by ID and cannot see it within the
  // inserting statement, so `insert().select()` would be rejected by RLS.
  const runId = crypto.randomUUID();
  const { error } = await supabase.from("agent_runs").insert({
    id: runId,
    organization_id: workspace.organization_id,
    workspace_id: workspace.id,
    created_by: user.id,
    title: input.title,
    objective: input.objective,
    context: documentIds.length ? { document_ids: documentIds } : {},
  });
  if (error) throw fromPostgrestError(error, "The task could not be queued.");
  return ok({ id: runId, status: "queued" }, { status: 202 });
});
