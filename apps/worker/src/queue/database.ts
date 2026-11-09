import postgres from "postgres";
import type { ClaimedJob } from "@ai-agent/shared";
import { getWorkerEnv } from "../env.js";
import type { EvidenceItem } from "../providers/types.js";

let database: ReturnType<typeof postgres> | undefined;
type JsonParameter = Parameters<ReturnType<typeof postgres>["json"]>[0];
export const jsonParameter = (value: unknown) => value as JsonParameter;

/**
 * The worker connects with the database URL (service-level access) because it
 * runs tenant-agnostic queue operations. Every query that touches tenant data
 * therefore filters explicitly by the organization/workspace stored on the job's run.
 */
export function getDatabase() {
  if (database) return database;

  const { SUPABASE_DB_URL } = getWorkerEnv();
  database = postgres(SUPABASE_DB_URL, {
    max: 4,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
  });

  return database;
}

export async function claimJobs(workerId: string, limit = 5): Promise<ClaimedJob[]> {
  const rows = await getDatabase()<ClaimedJob[]>`
    select * from private.claim_document_jobs(${workerId}, ${limit})
  `;
  return rows;
}

export async function searchRunEvidence(input: {
  organizationId: string; workspaceId: string; query: string; embedding?: number[]; limit: number; documentIds?: string[];
}): Promise<EvidenceItem[]> {
  const sql = getDatabase();
  const documentFilter = input.documentIds?.length
    ? sql`and chunk.document_id = any(${input.documentIds}::uuid[])`
    : sql``;
  if (input.embedding) {
    const vector = JSON.stringify(input.embedding);
    return sql<EvidenceItem[]>`
      select chunk.id as chunk_id, chunk.document_id, document.file_name, chunk.content,
        (1 - (chunk.embedding OPERATOR(extensions.<=>) ${vector}::extensions.vector))::real as similarity,
        chunk.metadata
      from public.document_chunks as chunk join public.documents as document
        on document.id = chunk.document_id and document.organization_id = chunk.organization_id and document.workspace_id = chunk.workspace_id
      where chunk.organization_id = ${input.organizationId} and chunk.workspace_id = ${input.workspaceId} ${documentFilter}
        and document.processing_status = 'indexed' and chunk.embedding is not null
        and 1 - (chunk.embedding OPERATOR(extensions.<=>) ${vector}::extensions.vector) >= 0.25
      order by chunk.embedding OPERATOR(extensions.<=>) ${vector}::extensions.vector limit ${input.limit}
    `;
  }
  return sql<EvidenceItem[]>`
    select chunk.id as chunk_id, chunk.document_id, document.file_name, chunk.content,
      null::real as similarity, chunk.metadata
    from public.document_chunks as chunk join public.documents as document
      on document.id = chunk.document_id and document.organization_id = chunk.organization_id and document.workspace_id = chunk.workspace_id
    where chunk.organization_id = ${input.organizationId} and chunk.workspace_id = ${input.workspaceId} ${documentFilter}
      and document.processing_status = 'indexed'
      and exists (
        select 1 from regexp_split_to_table(lower(${input.query}), '[^[:alnum:]_]+') as term
        where length(term) >= 3 and position(term in lower(chunk.content)) > 0
      )
    order by (
      select count(*) from regexp_split_to_table(lower(${input.query}), '[^[:alnum:]_]+') as term
      where length(term) >= 3 and position(term in lower(chunk.content)) > 0
    ) desc
    limit ${input.limit}
  `;
}

export async function markDocumentProcessing(documentId: string) {
  await getDatabase()`update public.documents set processing_status = 'processing', processing_error = null where id = ${documentId}`;
}

export async function loadDocument(documentId: string) {
  const [document] = await getDatabase()<Array<{
    id: string; organization_id: string; workspace_id: string; file_name: string;
    mime_type: string; storage_path: string; size_bytes: number;
  }>>`
    select id, organization_id, workspace_id, file_name, mime_type, storage_path, size_bytes
    from public.documents where id = ${documentId}
  `;
  return document ?? null;
}

export async function replaceDocumentIndex(input: {
  documentId: string; organizationId: string; workspaceId: string;
  chunks: Array<{ content: string; embedding: number[] | null; metadata: Record<string, string | number> }>;
  rows?: Array<Record<string, string>>;
  embeddingStatus: "completed" | "unavailable";
}) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    await transaction`delete from public.document_chunks where document_id = ${input.documentId}`;
    await transaction`delete from public.document_rows where document_id = ${input.documentId}`;
    for (let index = 0; index < input.chunks.length; index += 1) {
      const chunk = input.chunks[index]!;
      const vector = chunk.embedding ? JSON.stringify(chunk.embedding) : null;
      await transaction`
        insert into public.document_chunks (organization_id, workspace_id, document_id, chunk_index, content, embedding, metadata)
        values (${input.organizationId}, ${input.workspaceId}, ${input.documentId}, ${index}, ${chunk.content}, ${vector}::extensions.vector, ${transaction.json(chunk.metadata)})
      `;
    }
    for (let index = 0; index < (input.rows?.length ?? 0); index += 1) {
      await transaction`
        insert into public.document_rows (organization_id, workspace_id, document_id, row_index, row_data)
        values (${input.organizationId}, ${input.workspaceId}, ${input.documentId}, ${index + 1}, ${transaction.json(input.rows![index]!)})
      `;
    }
    await transaction`
      update public.documents
      set processing_status = 'indexed', processing_error = null, embedding_status = ${input.embeddingStatus}
      where id = ${input.documentId}
    `;
  });
}

export async function finishJob(jobId: string, workerId: string) {
  await getDatabase()`update private.job_queue set status = 'completed', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = ${jobId} and locked_by = ${workerId}`;
}

export async function failJob(job: ClaimedJob, workerId: string, errorMessage: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [updated] = await transaction<{ attempts: number; max_attempts: number }[]>`
      update private.job_queue
      set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
          available_at = now() + make_interval(secs => least(900, power(2, attempts)::integer * 15)),
          locked_at = null, locked_by = null, lease_expires_at = null,
          last_error = ${errorMessage.slice(0, 1000)}, updated_at = now()
      where id = ${job.id} and locked_by = ${workerId}
      returning attempts, max_attempts
    `;
    if (job.document_id) {
      const done = updated ? updated.attempts >= updated.max_attempts : true;
      await transaction`
        update public.documents set processing_status = ${done ? "failed" : "queued"}, processing_error = ${errorMessage.slice(0, 1000)}, embedding_status = 'failed'
        where id = ${job.document_id}
      `;
    }
  });
}

export async function closeQueueDatabase(): Promise<void> {
  if (!database) return;
  const activeDatabase = database;
  database = undefined;
  await activeDatabase.end({ timeout: 5 });
}
