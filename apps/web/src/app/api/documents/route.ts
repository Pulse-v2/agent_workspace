import { fromPostgrestError, ok, pageRange, withAuth } from "@/lib/api/http";
import { DOCUMENT_COLUMNS, listDocumentsQuerySchema } from "@/lib/validations/documents";


/** GET /api/documents?workspaceId=&q=&status=&page= — documents in a workspace the user can read (RLS). */
export const GET = withAuth(async ({ supabase }, request: Request) => {
  const query = listDocumentsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { from, to } = pageRange(query);
  let builder = supabase.from("documents").select(DOCUMENT_COLUMNS, { count: "exact" })
    .eq("workspace_id", query.workspaceId).order("created_at", { ascending: false }).range(from, to);
  if (query.q) builder = builder.ilike("file_name", `%${query.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
  if (query.status) builder = builder.eq("processing_status", query.status);
  const { data, error, count } = await builder;
  if (error) throw fromPostgrestError(error, "Documents could not be loaded.");
  return ok(data, { meta: { page: query.page, pageSize: query.pageSize, total: count ?? 0 } });
});
