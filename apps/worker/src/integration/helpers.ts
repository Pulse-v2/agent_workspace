import type { ClaimedJob } from "@ai-agent/shared";
import { createClient } from "@supabase/supabase-js";
import { getWorkerEnv } from "../env.js";
import { getDatabase } from "../queue/database.js";

export const sql = () => getDatabase();
export const storage = () => {
  const env = getWorkerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from("workspace-documents");
};

export type Tenant = { orgId: string; workspaceId: string; userId: string };
const created: Tenant[] = [];

/** Creates an isolated organization, workspace, and user directly in the database. */
export async function createTenant(role: "admin" | "member" = "admin"): Promise<Tenant> {
  const db = sql();
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  await db`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
    values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`it-${userId}@example.test`}, '', now(), '{}', '{}', now(), now(), false, false)`;
  await db`insert into public.organizations (id, name, slug) values (${orgId}, 'Integration Org', ${`it-${orgId}`})`;
  await db`insert into public.organization_members (organization_id, user_id, role) values (${orgId}, ${userId}, ${role})`;
  await db`insert into public.workspaces (id, organization_id, name, created_by) values (${workspaceId}, ${orgId}, 'Integration WS', ${userId})`;
  const tenant = { orgId, workspaceId, userId };
  created.push(tenant);
  return tenant;
}

export async function createRun(tenant: Tenant, objective = "Summarize the revenue notes.", context: Record<string, unknown> = {}) {
  const runId = crypto.randomUUID();
  await sql()`
    insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective, context)
    values (${runId}, ${tenant.orgId}, ${tenant.workspaceId}, ${tenant.userId}, 'Integration run', ${objective}, ${sql().json(context as never)})`;
  return runId;
}

export async function addChunk(tenant: Tenant, content: string, embedding: number[] | null = null) {
  const db = sql();
  const documentId = crypto.randomUUID();
  await db`
    insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum, processing_status)
    values (${documentId}, ${tenant.orgId}, ${tenant.workspaceId}, ${tenant.userId}, 'notes.txt', 'text/plain',
      ${`${tenant.orgId}/${tenant.workspaceId}/${documentId}/notes.txt`}, 10, ${documentId.replace(/-/g, "").padEnd(64, "0")}, 'indexed')`;
  await db`delete from private.job_queue where document_id = ${documentId}`;
  const [chunk] = await db<Array<{ id: string }>>`
    insert into public.document_chunks (organization_id, workspace_id, document_id, chunk_index, content, embedding, metadata)
    values (${tenant.orgId}, ${tenant.workspaceId}, ${documentId}, 0, ${content}, ${embedding ? JSON.stringify(embedding) : null}::extensions.vector, '{"section":"Text"}')
    returning id`;
  return { documentId, chunkId: chunk!.id };
}

/** Claims the job of one specific run, releasing any other job claimed by accident. */
export async function claimRunJob(runId: string, workerId = "integration-worker"): Promise<ClaimedJob | null> {
  const db = sql();
  await db`update private.job_queue set available_at = now() where run_id = ${runId} and status = 'queued'`;
  const jobs = await db<ClaimedJob[]>`select * from private.claim_agent_jobs(${workerId}, 25)`;
  const mine = jobs.find((job) => job.run_id === runId) ?? null;
  for (const other of jobs.filter((job) => job.run_id !== runId)) {
    await db`update private.job_queue set status = 'queued', attempts = greatest(attempts - 1, 0), locked_at = null, locked_by = null, lease_expires_at = null where id = ${other.id}`;
  }
  return mine;
}

export async function decideAsUser(userId: string, runId: string, stepId: string, decision: "approved" | "rejected", reason?: string) {
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    await tx`select public.decide_agent_run_approval(${runId}, ${stepId}, ${decision}, ${reason ?? null})`;
  });
}

export async function cleanupTenants() {
  const db = sql();
  for (const tenant of created.splice(0)) {
    await db`delete from public.organizations where id = ${tenant.orgId}`;
    await db`delete from auth.users where id = ${tenant.userId}`;
  }
}
