import type { DocumentInfo } from "../providers/types.js";
import type { CsvRow } from "../tools/csv/analyze.js";
import type { AgentRunRecord } from "./agent-runs.js";
import { getDatabase, jsonParameter } from "./database.js";

/**
 * Data access for tools. Every query is scoped by the organization and
 * workspace of the persisted run, never by identifiers from model output alone.
 */

export const MAX_CSV_ROWS = 50_000;

export type WorkspaceDocumentInfo = DocumentInfo;

/** Indexed documents the model may reference (IDs, names, and CSV columns only — never content). */
export async function listWorkspaceDocuments(run: AgentRunRecord, scope: readonly string[] | null = null, limit = 50): Promise<WorkspaceDocumentInfo[]> {
  const scopeFilter = scope?.length ? getDatabase()`and document.id = any(${[...scope]}::uuid[])` : getDatabase()``;
  const rows = await getDatabase()<Array<{ id: string; file_name: string; mime_type: string; row_count: number | null; columns: string[] | null }>>`
    select document.id, document.file_name, document.mime_type,
      (select count(*)::integer from public.document_rows as row where row.document_id = document.id) as row_count,
      (select array(select jsonb_object_keys(row.row_data)) from public.document_rows as row
        where row.document_id = document.id order by row.row_index limit 1) as columns
    from public.documents as document
    where document.organization_id = ${run.organization_id} and document.workspace_id = ${run.workspace_id}
      and document.processing_status = 'indexed' ${scopeFilter}
    order by document.created_at desc
    limit ${limit}
  `;
  return rows.map((row) => {
    const isCsv = row.mime_type === "text/csv" || row.file_name.toLowerCase().endsWith(".csv");
    return { ...row, is_csv: isCsv, row_count: isCsv ? row.row_count : null, columns: isCsv ? row.columns : null };
  });
}

export type CsvDataset = { document: { id: string; file_name: string }; rows: CsvRow[] } | { error: string };

export async function loadCsvDataset(run: AgentRunRecord, documentId: string): Promise<CsvDataset> {
  const sql = getDatabase();
  const [document] = await sql<Array<{ id: string; file_name: string; mime_type: string; processing_status: string; row_count: number }>>`
    select document.id, document.file_name, document.mime_type, document.processing_status,
      (select count(*)::integer from public.document_rows as row where row.document_id = document.id) as row_count
    from public.documents as document
    where document.id = ${documentId} and document.organization_id = ${run.organization_id} and document.workspace_id = ${run.workspace_id}
  `;
  if (!document) return { error: "No document with this ID exists in the workspace." };
  if (document.processing_status !== "indexed") return { error: `The document "${document.file_name}" is not indexed yet.` };
  if (document.row_count === 0) return { error: `The document "${document.file_name}" is not a parsed CSV dataset.` };
  if (document.row_count > MAX_CSV_ROWS) {
    return { error: `The dataset has ${document.row_count} rows; analysis is limited to ${MAX_CSV_ROWS} rows.` };
  }
  const rows = await sql<Array<{ row_index: number; row_data: Record<string, string> }>>`
    select row_index, row_data from public.document_rows
    where document_id = ${document.id} and organization_id = ${run.organization_id} and workspace_id = ${run.workspace_id}
    order by row_index
  `;
  return { document: { id: document.id, file_name: document.file_name }, rows: rows.map((row) => ({ index: row.row_index, data: row.row_data })) };
}

/** Returns the subset of chunk IDs that still exist in the run's workspace. */
export async function findExistingChunks(run: AgentRunRecord, chunkIds: string[]) {
  if (chunkIds.length === 0) return new Set<string>();
  const rows = await getDatabase()<Array<{ id: string }>>`
    select chunk.id from public.document_chunks as chunk
    where chunk.id = any(${chunkIds}::uuid[]) and chunk.organization_id = ${run.organization_id} and chunk.workspace_id = ${run.workspace_id}
  `;
  return new Set(rows.map((row) => row.id));
}

/**
 * Creates the report artifact for an approved step. Idempotent per step through
 * the unique artifacts.source_step_id index, so a retried execution after a crash
 * returns the existing artifact instead of creating a duplicate.
 */
export async function insertReportArtifact(input: {
  run: AgentRunRecord; stepId: string; title: string; artifactType: string; contentMarkdown: string;
  metadata: Record<string, unknown>; approvedBy: string;
}) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const inserted = await transaction<Array<{ id: string }>>`
      insert into public.artifacts (organization_id, workspace_id, run_id, created_by, title, artifact_type, content_markdown, metadata, source_step_id)
      values (${input.run.organization_id}, ${input.run.workspace_id}, ${input.run.id}, ${input.run.created_by}, ${input.title},
        ${input.artifactType}, ${input.contentMarkdown}, ${transaction.json(jsonParameter(input.metadata))}, ${input.stepId})
      on conflict (source_step_id) where source_step_id is not null do nothing
      returning id
    `;
    if (inserted[0]) {
      await transaction`
        insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
        values (${input.run.organization_id}, ${input.run.created_by}, 'artifact.created', 'artifact', ${inserted[0].id},
          ${transaction.json({ run_id: input.run.id, step_id: input.stepId, approved_by: input.approvedBy, source: "agent" })})
      `;
      return { id: inserted[0].id, created: true };
    }
    const [existing] = await transaction<Array<{ id: string }>>`select id from public.artifacts where source_step_id = ${input.stepId}`;
    return { id: existing!.id, created: false };
  });
}
