import { ApiError, fromPostgrestError, ok, withAuth } from "@/lib/api/http";
import { idParamSchema } from "@/lib/validations/agent-runs";

type Params = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * GET /api/documents/[id] — document details, index stats, and a short-lived
 * signed download URL. The signed URL is created with the user's session, so
 * Storage RLS must also allow the read.
 */
export const GET = withAuth(async ({ supabase }, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const { data: document, error } = await supabase.from("documents")
    .select("id, organization_id, workspace_id, uploaded_by, file_name, mime_type, size_bytes, checksum, storage_path, processing_status, processing_error, embedding_status, created_at")
    .eq("id", id).maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!document) throw new ApiError("not_found", "Document not found.");

  const [chunks, rows, signed] = await Promise.all([
    supabase.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_id", id),
    supabase.from("document_rows").select("id", { count: "exact", head: true }).eq("document_id", id),
    supabase.storage.from("workspace-documents").createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS, { download: document.file_name }),
  ]);
  // storage_path is internal; downloads go through the signed URL.
  return ok({
    id: document.id, organization_id: document.organization_id, workspace_id: document.workspace_id,
    uploaded_by: document.uploaded_by, file_name: document.file_name, mime_type: document.mime_type,
    size_bytes: document.size_bytes, checksum: document.checksum, processing_status: document.processing_status,
    processing_error: document.processing_error, embedding_status: document.embedding_status, created_at: document.created_at,
    chunk_count: chunks.count ?? 0,
    row_count: rows.count ?? 0,
    download_url: signed.data?.signedUrl ?? null,
    download_url_expires_in: signed.data ? SIGNED_URL_TTL_SECONDS : null,
  });
});

/** DELETE /api/documents/[id] — admins only (RLS + explicit check). Removes the stored file and the index. */
export const DELETE = withAuth(async ({ supabase }, _request: Request, { params }: Params) => {
  const id = idParamSchema.parse((await params).id);
  const { data: document, error } = await supabase.from("documents").select("id, organization_id, storage_path").eq("id", id).maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!document) throw new ApiError("not_found", "Document not found.");
  const { data: isAdmin } = await supabase.rpc("has_org_role", { p_organization_id: document.organization_id, p_roles: ["admin"] });
  if (!isAdmin) throw new ApiError("forbidden", "Only organization admins can delete documents.");

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", id);
  if (deleteError) throw fromPostgrestError(deleteError, "The document could not be deleted.");
  const { error: storageError } = await supabase.storage.from("workspace-documents").remove([document.storage_path]);
  if (storageError) console.error("Stored file cleanup failed", { documentId: id });
  return ok({ id, deleted: true });
});
