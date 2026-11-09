import { ApiError, fromPostgrestError, ok, readJson, withAuth, type AuthedContext } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";
import { updateWorkspaceSchema } from "@/lib/validations/workspaces";

type Params = { params: Promise<{ id: string }> };

async function loadWorkspace({ supabase }: AuthedContext, id: string) {
  const { data, error } = await supabase.from("workspaces")
    .select("id, organization_id, name, description, created_by, created_at, updated_at").eq("id", id).maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data) throw new ApiError("not_found", "Workspace not found.");
  return data;
}

async function requireAdmin({ supabase }: AuthedContext, organizationId: string) {
  const { data, error } = await supabase.rpc("has_org_role", { p_organization_id: organizationId, p_roles: ["admin"] });
  if (error) throw fromPostgrestError(error);
  if (!data) throw new ApiError("forbidden", "Only organization admins can change workspaces.");
}

/** GET /api/workspaces/[id] — workspace with resource counts. */
export const GET = withAuth(async (context, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const workspace = await loadWorkspace(context, id);
  const count = async (table: "documents" | "agent_runs" | "artifacts") => {
    const { count: total } = await context.supabase.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", id);
    return total ?? 0;
  };
  const [documents, runs, artifacts] = await Promise.all([count("documents"), count("agent_runs"), count("artifacts")]);
  return ok({ ...workspace, counts: { documents, runs, artifacts } });
});

/** PATCH /api/workspaces/[id] — admins update name/description. */
export const PATCH = withAuth(async (context, request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const input = updateWorkspaceSchema.parse(await readJson(request));
  const workspace = await loadWorkspace(context, id);
  await requireAdmin(context, workspace.organization_id);
  const { data, error } = await context.supabase.from("workspaces").update({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description || null } : {}),
  }).eq("id", id).select("id, organization_id, name, description, created_at, updated_at").single();
  if (error) throw fromPostgrestError(error, "The workspace could not be updated.");
  return ok(data);
});

/**
 * DELETE /api/workspaces/[id] — admins delete a workspace. Database rows cascade;
 * stored files are removed from the private bucket first.
 */
export const DELETE = withAuth(async (context, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const workspace = await loadWorkspace(context, id);
  await requireAdmin(context, workspace.organization_id);
  const { data: documents } = await context.supabase.from("documents").select("storage_path").eq("workspace_id", id);
  const paths = (documents ?? []).map((document) => document.storage_path);
  for (let index = 0; index < paths.length; index += 100) {
    await context.supabase.storage.from("workspace-documents").remove(paths.slice(index, index + 100));
  }
  const { error } = await context.supabase.from("workspaces").delete().eq("id", id);
  if (error) throw fromPostgrestError(error, "The workspace could not be deleted.");
  return ok({ id, deleted: true });
});
