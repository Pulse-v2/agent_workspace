import { z } from "zod";
import { ApiError, fromPostgrestError, ok, pageRange, paginationSchema, readJson, withAuth } from "@/lib/api/http";

const listSchema = paginationSchema.extend({
  workspaceId: z.guid().optional(),
  runId: z.guid().optional(),
  q: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  workspaceId: z.guid(),
  title: z.string().trim().min(1).max(200),
  artifactType: z.enum(["report", "summary", "analysis", "other"]).default("other"),
  contentMarkdown: z.string().trim().min(1).max(100_000),
});

/** GET /api/artifacts?workspaceId=&runId=&q=&page= */
export const GET = withAuth(async ({ supabase }, request: Request) => {
  const query = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { from, to } = pageRange(query);
  let builder = supabase.from("artifacts")
    .select("id, organization_id, workspace_id, run_id, created_by, title, artifact_type, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (query.workspaceId) builder = builder.eq("workspace_id", query.workspaceId);
  if (query.runId) builder = builder.eq("run_id", query.runId);
  if (query.q) builder = builder.ilike("title", `%${query.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
  const { data, error, count } = await builder;
  if (error) throw fromPostgrestError(error, "Artifacts could not be loaded.");
  return ok(data, { meta: { page: query.page, pageSize: query.pageSize, total: count ?? 0 } });
});

/** POST /api/artifacts — a user-authored artifact (agent artifacts are created by the worker after approval). */
export const POST = withAuth(async ({ supabase, user }, request: Request) => {
  const input = createSchema.parse(await readJson(request));
  const { data: workspace } = await supabase.from("workspaces").select("id, organization_id").eq("id", input.workspaceId).maybeSingle();
  if (!workspace) throw new ApiError("not_found", "Workspace not found.");
  const { data, error } = await supabase.from("artifacts").insert({
    organization_id: workspace.organization_id, workspace_id: workspace.id, created_by: user.id,
    title: input.title, artifact_type: input.artifactType, content_markdown: input.contentMarkdown, metadata: { generated_by: "user" },
  }).select("id, title, artifact_type, created_at").single();
  if (error) throw fromPostgrestError(error, "The artifact could not be created.");
  return ok(data, { status: 201 });
});
