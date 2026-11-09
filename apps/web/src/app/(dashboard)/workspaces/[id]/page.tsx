import { BookOpenText, FileText, Upload, Workflow } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunsTable } from "@/components/agents/runs-table";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/states";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listRuns } from "@/features/agent-runs/queries";
import { canContribute, requireWorkspace } from "@/features/app/context";
import { formatBytes, formatRelative } from "@/lib/format";

export default async function WorkspaceOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();

  const [runs, documents, artifacts] = await Promise.all([
    listRuns(context, { workspaceId: workspace.id, pageSize: 5 }),
    context.supabase.from("documents").select("id, file_name, size_bytes, processing_status, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5),
    context.supabase.from("artifacts").select("id, title, artifact_type, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5),
  ]);
  const contributor = canContribute(context.role);

  return (
    <div className="grid gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent agent runs</h2><Link href={`/workspaces/${workspace.id}/runs`} className="text-sm text-primary hover:underline">View all</Link></div>
        {runs.rows.length ? <RunsTable runs={runs.rows} showWorkspace={false} /> : (
          <EmptyState icon={Workflow} title="No runs in this workspace"
            description="Describe a task and the agent will plan it, search your documents, and report back with sources."
            action={contributor ? <Link href={`/workspaces/${workspace.id}/runs/new`} className={buttonVariants({ variant: "outline" })}>Create a task</Link> : null} />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div><CardTitle>Documents</CardTitle><CardDescription>Latest uploads and their indexing status.</CardDescription></div>
            {contributor && <Link href={`/workspaces/${workspace.id}/documents`} className={buttonVariants({ variant: "outline", size: "sm" })}><Upload />Upload</Link>}
          </CardHeader>
          <CardContent>
            {documents.data?.length ? (
              <ul className="divide-y">
                {documents.data.map((document) => (
                  <li key={document.id} className="flex items-center gap-3 py-2.5">
                    <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.file_name}</p><p className="text-xs text-muted-foreground">{formatBytes(document.size_bytes)} · {formatRelative(document.created_at)}</p></div>
                    <StatusBadge status={document.processing_status} />
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-sm text-muted-foreground">No documents yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div><CardTitle>Reports and artifacts</CardTitle><CardDescription>Saved outputs from approved agent actions.</CardDescription></div>
            <Link href={`/workspaces/${workspace.id}/artifacts`} className="text-sm text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {artifacts.data?.length ? (
              <ul className="divide-y">
                {artifacts.data.map((artifact) => (
                  <li key={artifact.id}>
                    <Link href={`/artifacts/${artifact.id}`} className="flex items-center gap-3 py-2.5 hover:underline">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{artifact.title}</span>
                      <span className="text-xs capitalize text-muted-foreground">{artifact.artifact_type} · {formatRelative(artifact.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-sm text-muted-foreground">No reports yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
