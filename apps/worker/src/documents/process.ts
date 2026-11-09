import { createClient } from "@supabase/supabase-js";
import type { ClaimedJob } from "@ai-agent/shared";
import { failJob, finishJob, loadDocument, markDocumentProcessing, replaceDocumentIndex } from "../queue/database.js";
import { chunkSections, extractDocument } from "./extract.js";
import { getProvider } from "../providers/index.js";
import { getWorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";

const env = getWorkerEnv();
const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function processDocumentJob(job: ClaimedJob, workerId: string, logger: Logger): Promise<"document_indexed" | "document_failed"> {
  if (!job.document_id) throw new Error("Document job has no document ID.");
  const log = logger.child({ job_id: job.id, document_id: job.document_id, attempt: job.attempts });
  const started = performance.now();
  try {
    await markDocumentProcessing(job.document_id);
    const document = await loadDocument(job.document_id);
    if (!document) throw new Error("Document record could not be loaded.");
    if (document.size_bytes > 52_428_800) throw new Error("Document exceeds the 50 MiB processing limit.");
    const { data: file, error: downloadError } = await storage.storage.from("workspace-documents").download(document.storage_path);
    if (downloadError || !file) throw new Error(`Private document download failed: ${downloadError?.message ?? "file not found"}`);
    const extracted = await extractDocument(document.file_name, document.mime_type, Buffer.from(await file.arrayBuffer()));
    const chunks = chunkSections(extracted.sections);
    if (!chunks.length) throw new Error("No searchable text chunks were produced.");

    let vectors: number[][] | null = null;
    const provider = getProvider("embedding");
    if (!provider.isDemo) {
      vectors = [];
      for (let start = 0; start < chunks.length; start += 64) {
        const response = await provider.generateEmbeddings(chunks.slice(start, start + 64).map((chunk) => chunk.content));
        vectors.push(...response.value);
      }
      if (vectors.some((vector) => vector.length !== 1536)) {
        throw new Error("Configured embedding dimensions must match the workspace's 1536-dimensional vector index.");
      }
    }

    await replaceDocumentIndex({
      documentId: document.id,
      organizationId: document.organization_id,
      workspaceId: document.workspace_id,
      chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors?.[index] ?? null })),
      rows: extracted.rows,
      embeddingStatus: vectors ? "completed" : "unavailable",
    });
    await finishJob(job.id, workerId);
    log.info("Document indexed", {
      duration_ms: Math.round(performance.now() - started), chunks: chunks.length,
      rows: extracted.rows?.length ?? 0, embeddings: Boolean(vectors),
    });
    return "document_indexed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed.";
    await failJob(job, workerId, message);
    log.error("Document processing failed", { duration_ms: Math.round(performance.now() - started), cause: message });
    return "document_failed";
  }
}
