import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, fromPostgrestError, ok, withAuth } from "@/lib/api/http";
import {
  contentMatchesType, DOCUMENT_COLUMNS, documentTypes, extensionOf, MAX_DOCUMENT_BYTES, sanitizeFileName, storageKeyName,
} from "@/lib/validations/documents";


const BUCKET = "workspace-documents";

/**
 * POST /api/documents/upload (multipart: workspaceId, file)
 *
 * Validates name, size, extension, and actual content on the server, computes
 * the checksum, rejects duplicates, stores the file in the private bucket under
 * the user's session (Storage RLS), and creates the document row, which queues
 * background processing. The organization comes from the workspace, never from
 * the client.
 */
export const POST = withAuth(async ({ supabase, user }, request: Request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError("bad_request", "Send the file as multipart/form-data.");
  }
  const workspaceId = z.guid().safeParse(form.get("workspaceId"));
  const file = form.get("file");
  if (!workspaceId.success) throw new ApiError("bad_request", "A valid workspaceId is required.");
  if (!(file instanceof File)) throw new ApiError("bad_request", "A file is required.");

  const fileName = sanitizeFileName(file.name);
  const extension = extensionOf(fileName);
  if (!extension) throw new ApiError("bad_request", "Unsupported file type. Upload PDF, DOCX, TXT, Markdown, or CSV.");
  if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) throw new ApiError("bad_request", "Files must be between 1 byte and 50 MiB.");

  const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
    .select("id, organization_id").eq("id", workspaceId.data).maybeSingle();
  if (workspaceError) throw fromPostgrestError(workspaceError);
  if (!workspace) throw new ApiError("not_found", "Workspace not found.");
  const { data: canUpload, error: roleError } = await supabase.rpc("has_org_role", {
    p_organization_id: workspace.organization_id, p_roles: ["admin", "member"],
  });
  if (roleError) throw fromPostgrestError(roleError);
  if (!canUpload) throw new ApiError("forbidden", "Viewers cannot upload documents.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesType(extension, bytes)) throw new ApiError("bad_request", `The file content does not match the .${extension} type.`);
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const { data: duplicate } = await supabase.from("documents").select("id, file_name")
    .eq("workspace_id", workspace.id).eq("checksum", checksum).maybeSingle();
  if (duplicate) throw new ApiError("conflict", `This file is already in the workspace as "${duplicate.file_name}".`, { documentId: duplicate.id });

  const documentId = crypto.randomUUID();
  const mimeType = documentTypes[extension];
  const storagePath = `${workspace.organization_id}/${workspace.id}/${documentId}/${storageKeyName(fileName)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) {
    console.error("Document upload to storage failed", { message: uploadError.message.slice(0, 200) });
    throw new ApiError("internal_error", "The file could not be stored. Please try again.");
  }

  const { data: document, error: insertError } = await supabase.from("documents").insert({
    id: documentId, organization_id: workspace.organization_id, workspace_id: workspace.id, uploaded_by: user.id,
    file_name: fileName, mime_type: mimeType, storage_path: storagePath, size_bytes: file.size, checksum,
  }).select(DOCUMENT_COLUMNS).single();
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    if (insertError.code === "23505") throw new ApiError("conflict", "This file is already in the workspace.");
    throw fromPostgrestError(insertError, "The document could not be saved.");
  }
  return ok(document, { status: 201 });
});
