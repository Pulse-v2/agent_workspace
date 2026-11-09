import { ApiError, fromPostgrestError, ok, readJson, withAuth } from "@/lib/api/http";
import { createOrganizationSchema, slugify } from "@/lib/validations/workspaces";

/** GET /api/organizations — organizations the user belongs to, with their role. */
export const GET = withAuth(async ({ supabase, user }) => {
  const { data: memberships, error } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id);
  if (error) throw fromPostgrestError(error);
  if (!memberships.length) return ok([]);
  const { data: organizations, error: organizationsError } = await supabase.from("organizations")
    .select("id, name, slug, created_at").in("id", memberships.map((membership) => membership.organization_id)).order("name");
  if (organizationsError) throw fromPostgrestError(organizationsError);
  return ok(organizations.map((organization) => ({
    ...organization,
    role: memberships.find((membership) => membership.organization_id === organization.id)?.role,
  })));
});

/** POST /api/organizations — creates an organization and its first workspace; the creator becomes admin. */
export const POST = withAuth(async ({ supabase }, request: Request) => {
  const input = createOrganizationSchema.parse(await readJson(request));
  const slug = slugify(input.name);
  if (slug.length < 2) throw new ApiError("bad_request", "Use at least two Latin letters or numbers in the organization name.");
  const { data, error } = await supabase.rpc("create_organization_with_workspace", {
    p_organization_name: input.name, p_organization_slug: slug, p_workspace_name: input.workspaceName,
  });
  if (error) {
    if (error.code === "23505") throw new ApiError("conflict", "That organization URL is already in use. Choose a more distinctive name.");
    throw fromPostgrestError(error, "The organization could not be created.");
  }
  return ok(data?.[0] ?? null, { status: 201 });
});
