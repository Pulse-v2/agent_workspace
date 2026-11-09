import type { OrganizationRole } from "@ai-agent/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export const ORGANIZATION_COOKIE = "northstar-org";

export type OrganizationSummary = { id: string; name: string; slug: string; role: OrganizationRole };
export type WorkspaceSummary = { id: string; name: string; description: string | null; organization_id: string; created_at: string; updated_at: string };

export type AppContext = {
  supabase: SupabaseClient<Database>;
  user: { id: string; email: string | null };
  organizations: OrganizationSummary[];
  organization: OrganizationSummary;
  role: OrganizationRole;
  workspaces: WorkspaceSummary[];
};

export const canContribute = (role: OrganizationRole) => role === "admin" || role === "member";
export const isAdmin = (role: OrganizationRole) => role === "admin";
/** Mirrors can_approve_agent_run(): admins, or the member who created the run. */
export const canApproveRun = (context: Pick<AppContext, "role" | "user">, createdBy: string) =>
  context.role === "admin" || (context.role === "member" && createdBy === context.user.id);

type LoadResult = { status: "unconfigured" } | { status: "signed-out" } | { status: "no-organization" } | { status: "ready"; context: AppContext };

/**
 * Loads the signed-in user's organizations and the selected organization's
 * workspaces. The organization cookie is only a preference: it is honored only
 * if the user is a member; all data access still goes through RLS.
 */
export const loadAppContext = cache(async (): Promise<LoadResult> => {
  // Everything below depends on the request (session, current time in views); never prerender it.
  await connection();
  const supabase = await createClient();
  if (!supabase) return { status: "unconfigured" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const { data: memberships } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id);
  if (!memberships?.length) return { status: "no-organization" };
  const { data: organizations } = await supabase.from("organizations").select("id, name, slug")
    .in("id", memberships.map((membership) => membership.organization_id)).order("name");
  const summaries: OrganizationSummary[] = (organizations ?? []).map((organization) => ({
    ...organization,
    role: memberships.find((membership) => membership.organization_id === organization.id)!.role as OrganizationRole,
  }));
  if (!summaries.length) return { status: "no-organization" };

  const preferred = (await cookies()).get(ORGANIZATION_COOKIE)?.value;
  const organization = summaries.find((item) => item.id === preferred) ?? summaries[0]!;
  const { data: workspaces } = await supabase.from("workspaces")
    .select("id, name, description, organization_id, created_at, updated_at")
    .eq("organization_id", organization.id).order("name");

  return {
    status: "ready",
    context: {
      supabase,
      user: { id: user.id, email: user.email ?? null },
      organizations: summaries,
      organization,
      role: organization.role,
      workspaces: workspaces ?? [],
    },
  };
});

/** For pages inside the dashboard: redirects to sign-in or onboarding when needed. */
export async function requireAppContext(): Promise<AppContext> {
  const result = await loadAppContext();
  if (result.status === "signed-out" || result.status === "unconfigured") redirect("/sign-in");
  if (result.status === "no-organization") redirect("/onboarding");
  return result.context;
}

export async function requireWorkspace(workspaceId: string) {
  const context = await requireAppContext();
  const workspace = context.workspaces.find((item) => item.id === workspaceId);
  return { context, workspace: workspace ?? null };
}
