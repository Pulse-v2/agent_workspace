/**
 * Seeds an explorable demo organization by running the REAL pipeline:
 * files are uploaded to private Storage and indexed by the document worker,
 * runs are executed by the agent engine with the deterministic demo provider,
 * and approval decisions go through decide_agent_run_approval(). Nothing is
 * hand-drawn: timelines, events, and artifacts are what the engine produced.
 * Every seeded run carries context.seeded_demo = true and is badged in the UI.
 *
 *   pnpm seed:demo            # create the demo data (skips if it exists)
 *   pnpm seed:demo --reset    # delete and recreate it
 */
import "../load-env.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// The agent engine must use the deterministic demo provider for seeded runs.
// Embeddings still use a configured key, so seeded documents work with semantic search.
process.env.LLM_PROVIDER = "demo";
process.env.DEMO_MODE = "true";

const { getWorkerEnv } = await import("../env.js");
const { logger } = await import("../logger.js");
const { getDatabase, claimJobs, closeQueueDatabase } = await import("../queue/database.js");
const { claimAgentJobs } = await import("../queue/agent-runs.js");
const { processDocumentJob } = await import("../documents/process.js");
const { executeAgentJob } = await import("../agent/execute-run.js");

const DEMO_SLUG = "northstar-demo";
const DEMO_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@northstar.dev";
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "northstar-demo-2026";
const FIXTURES = fileURLToPath(new URL("../../../../tests/fixtures/demo/", import.meta.url));
const WORKER_ID = "demo-seeder";
const log = logger.child({ worker_id: WORKER_ID });

const env = getWorkerEnv();
const sql = getDatabase();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const documents = [
  { name: "q3-sales-review.md", mime: "text/markdown" },
  { name: "regional-notes.txt", mime: "text/plain" },
  { name: "monthly-revenue-2026.csv", mime: "text/csv" },
];

type DemoRun = { title: string; objective: string; decision?: { decision: "approved" | "rejected"; reason?: string } | "pending"; cancel?: boolean };
const runs: DemoRun[] = [
  {
    title: "Q3 regional revenue report",
    objective: "Analyze the Q3 sales review, regional notes, and monthly revenue dataset. Compare revenue across regions and save a report with supporting sources.",
    decision: { decision: "approved", reason: "Numbers match the finance summary." },
  },
  {
    title: "Unusual monthly revenue changes",
    objective: "Identify unusual month-over-month revenue changes by region in the 2026 revenue dataset and explain what the notes say about them.",
  },
  {
    title: "Draft report for the APAC review",
    objective: "Summarize the APAC situation from the regional notes and save a short report for the APAC review meeting.",
    decision: { decision: "rejected", reason: "Wait for the final September numbers after the finance close." },
  },
  {
    title: "Leadership briefing on regional performance",
    objective: "Prepare a leadership briefing on regional performance and risks for Q4 planning and save it as a report.",
    decision: "pending",
  },
  {
    title: "Discount trend in North America",
    objective: "Check how the average discount changed in North America during 2026.",
    cancel: true,
  },
];

async function findUser(email: string) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email === email);
    if (user || data.users.length < 200) return user ?? null;
  }
  return null;
}

async function asUser<T>(userId: string, query: (tx: typeof sql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return query(tx as unknown as typeof sql);
  });
}

async function drainQueues() {
  const shutdown = new AbortController().signal;
  for (let idle = 0; idle < 3;) {
    const [documentJobs, agentJobs] = await Promise.all([claimJobs(WORKER_ID, 5), claimAgentJobs(WORKER_ID, 5)]);
    for (const job of documentJobs) await processDocumentJob(job, WORKER_ID, log);
    for (const job of agentJobs) await executeAgentJob(job, WORKER_ID, shutdown, log);
    idle = documentJobs.length + agentJobs.length === 0 ? idle + 1 : 0;
    if (idle) await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function main() {
  const reset = process.argv.includes("--reset");
  const [existing] = await sql<Array<{ id: string }>>`select id from public.organizations where slug = ${DEMO_SLUG}`;
  if (existing && !reset) {
    console.log(`Demo data already exists. Sign in as ${DEMO_EMAIL}. Use --reset to recreate it.`);
    return;
  }
  if (existing) {
    const paths = await sql<Array<{ storage_path: string }>>`select storage_path from public.documents where organization_id = ${existing.id}`;
    if (paths.length) await admin.storage.from("workspace-documents").remove(paths.map((row) => row.storage_path));
    await sql`delete from public.organizations where id = ${existing.id}`;
    console.log("Removed the previous demo organization.");
  }

  let user = await findUser(DEMO_EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const userId = user.id;

  const [organization] = await sql<Array<{ id: string }>>`insert into public.organizations (name, slug) values ('Northstar Demo', ${DEMO_SLUG}) returning id`;
  const orgId = organization!.id;
  await sql`insert into public.organization_members (organization_id, user_id, role) values (${orgId}, ${userId}, 'admin')`;
  const [workspace] = await sql<Array<{ id: string }>>`
    insert into public.workspaces (organization_id, name, description, created_by)
    values (${orgId}, 'Sales Analytics', 'Seeded demo workspace: Q3 sales review, regional notes, and a monthly revenue dataset.', ${userId})
    returning id`;
  const workspaceId = workspace!.id;
  await sql`insert into public.workspaces (organization_id, name, description, created_by) values (${orgId}, 'Customer Research', 'An empty workspace to try uploads.', ${userId})`;

  for (const document of documents) {
    const bytes = await readFile(`${FIXTURES}${document.name}`);
    const documentId = crypto.randomUUID();
    const storagePath = `${orgId}/${workspaceId}/${documentId}/${document.name}`;
    const { error } = await admin.storage.from("workspace-documents").upload(storagePath, bytes, { contentType: document.mime, upsert: false });
    if (error) throw error;
    const checksum = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    await sql`
      insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum)
      values (${documentId}, ${orgId}, ${workspaceId}, ${userId}, ${document.name}, ${document.mime}, ${storagePath}, ${bytes.length}, ${checksum})`;
  }
  console.log("Uploaded demo documents; indexing…");
  await drainQueues();

  const runIds = new Map<DemoRun, string>();
  for (const run of runs) {
    const runId = crypto.randomUUID();
    runIds.set(run, runId);
    await sql`
      insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective, context)
      values (${runId}, ${orgId}, ${workspaceId}, ${userId}, ${run.title}, ${run.objective}, ${sql.json({ seeded_demo: true })})`;
    if (run.cancel) {
      await asUser(userId, (tx) => tx`select public.cancel_agent_run(${runId})`);
    }
  }
  console.log("Executing demo runs with the deterministic demo provider…");
  await drainQueues();

  for (const run of runs) {
    if (!run.decision || run.decision === "pending") continue;
    const decision = run.decision;
    const runId = runIds.get(run)!;
    const [step] = await sql<Array<{ id: string }>>`select id from public.agent_run_steps where run_id = ${runId} and status = 'waiting_approval'`;
    if (!step) {
      console.warn(`Run "${run.title}" did not request approval; skipping the decision.`);
      continue;
    }
    await asUser(userId, (tx) => tx`select public.decide_agent_run_approval(${runId}, ${step.id}, ${decision.decision}, ${decision.reason ?? null})`);
  }
  await drainQueues();

  const summary = await sql<Array<{ status: string; count: number }>>`
    select status, count(*)::integer as count from public.agent_runs where organization_id = ${orgId} group by status order by status`;
  const [artifacts] = await sql<Array<{ count: number }>>`select count(*)::integer as count from public.artifacts where organization_id = ${orgId}`;
  console.log("\nDemo data ready.");
  console.log(`  Sign in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Runs: ${summary.map((row) => `${row.count} ${row.status}`).join(", ")}`);
  console.log(`  Reports: ${artifacts?.count ?? 0}`);
}

try {
  await main();
} finally {
  await closeQueueDatabase();
}
