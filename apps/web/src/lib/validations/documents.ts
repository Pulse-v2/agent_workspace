import { z } from "zod";
import { paginationSchema } from "@/lib/validations/pagination";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const documentTypes = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
} as const;
export const ACCEPTED_EXTENSIONS = Object.keys(documentTypes).map((extension) => `.${extension}`).join(",");

export const documentStatuses = ["uploading", "queued", "processing", "indexed", "failed"] as const;

export const listDocumentsQuerySchema = paginationSchema.extend({
  workspaceId: z.guid(),
  q: z.string().trim().max(200).optional(),
  status: z.enum(documentStatuses).optional(),
});

export function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  const extension = match?.[1]?.toLowerCase();
  return extension && extension in documentTypes ? (extension as keyof typeof documentTypes) : null;
}

/** Display-safe file name: no path separators or control characters, bounded length, extension preserved. */
export function sanitizeFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned || "file";
  const extension = /\.[^.]+$/.exec(cleaned)?.[0] ?? "";
  return cleaned.slice(0, 180 - extension.length) + extension;
}

/** ASCII-only object key segment for Supabase Storage. */
export function storageKeyName(fileName: string) {
  return fileName.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";
}

/**
 * Checks file content against the claimed type so a renamed binary cannot be
 * stored as text (or an arbitrary file as PDF/DOCX).
 */
export function contentMatchesType(extension: keyof typeof documentTypes, bytes: Uint8Array) {
  if (extension === "pdf") return bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  if (extension === "docx") return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (bytes.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export const DOCUMENT_COLUMNS = "id, organization_id, workspace_id, uploaded_by, file_name, mime_type, size_bytes, processing_status, processing_error, embedding_status, created_at";
