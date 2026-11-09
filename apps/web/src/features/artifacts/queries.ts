import type { AppContext } from "@/features/app/context";

export async function listArtifacts(context: AppContext, options: { workspaceId?: string; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? 24;
  let query = context.supabase.from("artifacts")
    .select("id, workspace_id, run_id, source_step_id, title, artifact_type, metadata, created_at", { count: "exact" })
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (options.workspaceId) query = query.eq("workspace_id", options.workspaceId);
  if (options.q) query = query.ilike("title", `%${options.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
  const { data, count, error } = await query;
  if (error) throw new Error("Artifacts could not be loaded.");
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getArtifact(context: AppContext, id: string) {
  const { data } = await context.supabase.from("artifacts").select("*").eq("id", id).maybeSingle();
  return data;
}
