import { z } from "zod";
import { ApiError, fromPostgrestError, ok, pageRange, paginationSchema, readJson, withAuth } from "@/lib/api/http";
import { createWorkspaceSchema } from "@/lib/validations/workspaces";

const listSchema = paginationSchema.extend({ organizationId: z.guid().optional() });

/** GET /api/workspaces?organizationId= — workspaces the user can read (RLS). */
export const GET = withAuth(async ({ supabase }, request: Request) => {
  const query = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { from, to } = pageRange(query);
  let builder = supabase.from("workspaces").select("id, organization_id, name, description, created_by, created_at, updated_at", { count: "exact" })
    .order("name").range(from, to);
  if (query.organizationId) builder = builder.eq("organization_id", query.organizationId);
  const { data, error, count } = await builder;
  if (error) throw fromPostgrestError(error);
  return ok(data, { meta: { page: query.page, pageSize: query.pageSize, total: count ?? 0 } });
});

/** POST /api/workspaces — admins create workspaces in their organization (enforced by RLS and checked here). */
export const POST = withAuth(async ({ supabase, user }, request: Request) => {
  const input = createWorkspaceSchema.parse(await readJson(request));
  const { data: isAdmin, error: roleError } = await supabase.rpc("has_org_role", { p_organization_id: input.organizationId, p_roles: ["admin"] });
  if (roleError) throw fromPostgrestError(roleError);
  if (!isAdmin) throw new ApiError("forbidden", "Only organization admins can create workspaces.");
  const { data, error } = await supabase.from("workspaces").insert({
    organization_id: input.organizationId, name: input.name, description: input.description || null, created_by: user.id,
  }).select("id, organization_id, name, description, created_at, updated_at").single();
  if (error) throw fromPostgrestError(error, "The workspace could not be created.");
  return ok(data, { status: 201 });
});
