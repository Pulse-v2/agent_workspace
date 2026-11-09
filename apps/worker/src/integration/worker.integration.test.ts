import { afterAll, describe, expect, it, vi } from "vitest";
import { executeAgentJob } from "../agent/execute-run.js";
import { processDocumentJob } from "../documents/process.js";
import { createLogger } from "../logger.js";
import { DemoProvider } from "../providers/demo.js";
import { claimJobs, closeQueueDatabase, searchRunEvidence } from "../queue/database.js";
import { loadAgentRun } from "../queue/agent-runs.js";
import { addChunk, claimRunJob, cleanupTenants, createRun, createTenant, decideAsUser, sql, storage } from "./helpers.js";

/**
 * Integration tests against the local Supabase stack (`pnpm db:start`).
 * They exercise real SQL functions, RLS-relevant scoping, Storage, and the
 * agent engine with the deterministic demo provider. Do not run a worker
 * process at the same time.
 */
const logger = createLogger({ test: "integration" });
vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);
const never = new AbortController().signal;

const runStatus = async (runId: string) => (await sql()<Array<{ status: string; error_code: string | null; retry_count: number }>>`
  select status, error_code, retry_count from public.agent_runs where id = ${runId}`)[0]!;
const steps = (runId: string) => sql()<Array<{ id: string; status: string; tool_name: string | null; error_message: string | null }>>`
  select id, status, tool_name, error_message from public.agent_run_steps where run_id = ${runId} order by step_index`;
const events = async (runId: string) => (await sql()<Array<{ sequence: number; event_type: string }>>`
  select sequence::integer as sequence, event_type from public.agent_run_events where run_id = ${runId} order by sequence`);

afterAll(async () => {
  await cleanupTenants();
  await closeQueueDatabase();
});

describe("job queue", () => {
  it("lets exactly one of many concurrent workers claim a job", async () => {
    const tenant = await createTenant();
    const runId = await createRun(tenant);
    const claims = await Promise.all(Array.from({ length: 6 }, (_, index) => claimRunJob(runId, `racer-${index}`)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await sql()`update private.job_queue set status = 'cancelled', locked_at = null, locked_by = null, lease_expires_at = null where run_id = ${runId}`;
  });
});

describe("agent execution against the database", () => {
  it("completes a run with ordered events and a sourced answer", async () => {
    const tenant = await createTenant();
    await addChunk(tenant, "EMEA revenue grew 12 percent while APAC revenue declined.");
    const runId = await createRun(tenant, "How did EMEA revenue change?");
    const job = await claimRunJob(runId);
    await expect(executeAgentJob(job!, "integration-worker", never, logger)).resolves.toBe("completed");
    expect((await runStatus(runId)).status).toBe("completed");
    const sequence = (await events(runId)).map((event) => event.sequence);
    expect(sequence).toEqual(sequence.map((_, index) => index + 1));
    const final = await sql()<Array<{ output_json: { verified: boolean; citations: unknown[] } }>>`
      select output_json from public.agent_run_steps where run_id = ${runId} and step_type = 'final'`;
    expect(final[0]?.output_json).toMatchObject({ verified: true });
  });

  it("recovers a run after a worker crash: lease expires, another worker resumes", async () => {
    const tenant = await createTenant();
    await addChunk(tenant, "Revenue notes for the crash test.");
    const runId = await createRun(tenant, "Summarize the revenue notes.");
    const crashed = await claimRunJob(runId, "crashing-worker");
    expect(crashed?.attempts).toBe(1);
    // Simulate a crash mid-step: a step is left running and the lease expires.
    const run = await loadAgentRun(runId);
    await sql()`
      insert into public.agent_run_steps (run_id, organization_id, workspace_id, step_index, step_type, title, status, started_at)
      values (${runId}, ${run!.organization_id}, ${run!.workspace_id}, 0, 'analysis', 'Interrupted step', 'running', now())`;
    await sql()`update public.agent_runs set status = 'running' where id = ${runId}`;
    await sql()`update private.job_queue set lease_expires_at = now() - interval '1 second' where run_id = ${runId}`;

    const reclaimed = await claimRunJob(runId, "rescue-worker");
    expect(reclaimed?.attempts).toBe(2);
    await expect(executeAgentJob(reclaimed!, "rescue-worker", never, logger)).resolves.toBe("completed");
    const all = await steps(runId);
    expect(all[0]).toMatchObject({ status: "failed", error_message: expect.stringMatching(/Interrupted/) });
    expect((await runStatus(runId)).status).toBe("completed");
  });

  it("retries a transient failure with backoff, then succeeds", async () => {
    const tenant = await createTenant();
    await addChunk(tenant, "Notes for the retry test.");
    const runId = await createRun(tenant);
    const spy = vi.spyOn(DemoProvider.prototype, "generatePlan").mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("retrying");
    spy.mockRestore();
    expect(await runStatus(runId)).toMatchObject({ status: "queued", retry_count: 1, error_code: "database_unavailable" });
    const [job] = await sql()<Array<{ available_at: Date }>>`select available_at from private.job_queue where run_id = ${runId}`;
    expect(job!.available_at.getTime()).toBeGreaterThan(Date.now());
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("completed");
    expect((await events(runId)).map((event) => event.event_type)).toContain("run_retrying");
  });

  it("fails permanently when the run creator lost permission", async () => {
    const tenant = await createTenant("member");
    const runId = await createRun(tenant);
    await sql()`update public.organization_members set role = 'viewer' where user_id = ${tenant.userId}`;
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("failed");
    expect(await runStatus(runId)).toMatchObject({ status: "failed", error_code: "permission_denied" });
  });

  it("skips a run cancelled before execution", async () => {
    const tenant = await createTenant();
    const runId = await createRun(tenant);
    const job = await claimRunJob(runId);
    await sql().begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: tenant.userId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      await tx`select public.cancel_agent_run(${runId})`;
    });
    await expect(executeAgentJob(job!, "integration-worker", never, logger)).resolves.toBe("skipped");
    expect((await runStatus(runId)).status).toBe("cancelled");
  });
});

describe("approval workflow end to end", () => {
  it("pauses, resumes after approval, saves exactly one artifact, and audits the decision", async () => {
    const tenant = await createTenant();
    await addChunk(tenant, "Q3 revenue summary for the report.");
    const runId = await createRun(tenant, "Summarize Q3 revenue and save a report.");
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("paused_for_approval");
    const pending = (await steps(runId)).find((step) => step.status === "waiting_approval");
    expect(pending?.tool_name).toBe("save_report");
    expect(await sql()`select id from public.artifacts where run_id = ${runId}`).toHaveLength(0);

    await decideAsUser(tenant.userId, runId, pending!.id, "approved");
    await expect(decideAsUser(tenant.userId, runId, pending!.id, "approved")).rejects.toThrow(/already been decided/);
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("completed");

    const artifacts = await sql()<Array<{ source_step_id: string; metadata: { approved_by: string } }>>`select source_step_id, metadata from public.artifacts where run_id = ${runId}`;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ source_step_id: pending!.id, metadata: { approved_by: tenant.userId } });
    const audit = await sql()<Array<{ action: string }>>`select action from public.audit_logs where organization_id = ${tenant.orgId} order by created_at`;
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["agent_run.approval_approved", "artifact.created"]));
  });

  it("returns a rejection to the agent and saves nothing", async () => {
    const tenant = await createTenant();
    await addChunk(tenant, "Notes for the rejection test.");
    const runId = await createRun(tenant, "Draft notes and save a report.");
    await executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger);
    const pending = (await steps(runId)).find((step) => step.status === "waiting_approval");
    await decideAsUser(tenant.userId, runId, pending!.id, "rejected", "Not yet");
    await expect(executeAgentJob((await claimRunJob(runId))!, "integration-worker", never, logger)).resolves.toBe("completed");
    expect(await sql()`select id from public.artifacts where run_id = ${runId}`).toHaveLength(0);
    expect((await steps(runId)).find((step) => step.id === pending!.id)?.status).toBe("rejected");
  });
});

describe("document ingestion", () => {
  it("extracts, chunks, and stores rows with source locations", async () => {
    const tenant = await createTenant();
    const upload = async (name: string, mime: string, content: string) => {
      const documentId = crypto.randomUUID();
      const path = `${tenant.orgId}/${tenant.workspaceId}/${documentId}/${name}`;
      const { error } = await storage().upload(path, new TextEncoder().encode(content), { contentType: mime });
      if (error) throw error;
      await sql()`
        insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum)
        values (${documentId}, ${tenant.orgId}, ${tenant.workspaceId}, ${tenant.userId}, ${name}, ${mime}, ${path}, ${content.length}, ${documentId.replace(/-/g, "").padEnd(64, "1")})`;
      return { documentId, path };
    };
    const markdown = await upload("review.md", "text/markdown", "# Summary\nRevenue grew.\n\n## Risks\nAPAC pipeline is thin.");
    const csv = await upload("sales.csv", "text/csv", "region,revenue\nEMEA,100\nAPAC,80\n");

    for (let round = 0; round < 3; round += 1) {
      const jobs = (await claimJobs("integration-docs", 10)).filter((job) => ([markdown.documentId, csv.documentId] as string[]).includes(job.document_id!));
      for (const job of jobs) await expect(processDocumentJob(job, "integration-docs", logger)).resolves.toBe("document_indexed");
    }
    const sections = await sql()<Array<{ section: string }>>`select metadata->>'section' as section from public.document_chunks where document_id = ${markdown.documentId} order by chunk_index`;
    expect(sections.map((row) => row.section)).toEqual(["Summary", "Risks"]);
    const rows = await sql()<Array<{ row_index: number; row_data: Record<string, string> }>>`select row_index, row_data from public.document_rows where document_id = ${csv.documentId} order by row_index`;
    expect(rows).toEqual([{ row_index: 1, row_data: { region: "EMEA", revenue: "100" } }, { row_index: 2, row_data: { region: "APAC", revenue: "80" } }]);
    const chunkMetadata = await sql()<Array<{ metadata: Record<string, number> }>>`select metadata from public.document_chunks where document_id = ${csv.documentId} order by chunk_index limit 1`;
    expect(chunkMetadata[0]?.metadata).toMatchObject({ row_start: 1, row_end: 1 });
    await storage().remove([markdown.path, csv.path]);
  });
});

describe("retrieval isolation", () => {
  it("never returns chunks from another organization, for semantic or keyword search", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const vector = Array.from({ length: 1536 }, (_, index) => (index % 7) / 7);
    const a = await addChunk(tenantA, "Shared keyword quarterly revenue for A", vector);
    await addChunk(tenantB, "Shared keyword quarterly revenue for B", vector);
    const semantic = await searchRunEvidence({ organizationId: tenantA.orgId, workspaceId: tenantA.workspaceId, query: "quarterly revenue", embedding: vector, limit: 10 });
    const keyword = await searchRunEvidence({ organizationId: tenantA.orgId, workspaceId: tenantA.workspaceId, query: "quarterly revenue", limit: 10 });
    expect(semantic.map((item) => item.chunk_id)).toEqual([a.chunkId]);
    expect(keyword.map((item) => item.chunk_id)).toEqual([a.chunkId]);
  });
});
