import { ApiError, fromPostgrestError, ok, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/artifacts/[id] — artifact JSON, or the raw Markdown as a download
 * with ?format=markdown.
 */
export const GET = withAuth(async ({ supabase }, request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const { data, error } = await supabase.from("artifacts").select("*").eq("id", id).maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data) throw new ApiError("not_found", "Artifact not found.");

  if (new URL(request.url).searchParams.get("format") === "markdown") {
    const fileName = `${data.title.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80) || "report"}.md`;
    return new Response(data.content_markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  }
  return ok(data);
});
