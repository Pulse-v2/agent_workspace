import { Bot, Download, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SourceList } from "@/components/agents/source-list";
import { Markdown } from "@/components/common/markdown";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { parseArtifactMetadata } from "@/features/agent-runs/view-model";
import { requireAppContext } from "@/features/app/context";
import { getArtifact } from "@/features/artifacts/queries";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Report" };

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const context = await requireAppContext();
  const artifact = await getArtifact(context, id);
  if (!artifact) notFound();
  const workspace = context.workspaces.find((item) => item.id === artifact.workspace_id);
  const provenance = parseArtifactMetadata(artifact.metadata);
  // Only the worker can set source_step_id (database trigger); metadata alone could be user-authored.
  const byAgent = artifact.source_step_id !== null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/artifacts" }, ...(workspace ? [{ label: workspace.name, href: `/workspaces/${workspace.id}/artifacts` }] : []), { label: artifact.title }]}
        title={artifact.title}
        description={<span className="capitalize">{artifact.artifact_type} · created {formatDateTime(artifact.created_at)}</span>}
        actions={<a href={`/api/artifacts/${artifact.id}?format=markdown`} className={buttonVariants({ variant: "outline" })}><Download />Export Markdown</a>}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-xl border bg-background p-5 sm:p-8"><Markdown content={artifact.content_markdown} /></article>
        <aside className="grid gap-4">
          <section className="rounded-xl border bg-background p-4 text-sm">
            <h2 className="mb-3 font-semibold">Provenance</h2>
            <dl className="grid gap-2">
              <div className="flex items-center gap-2">
                {byAgent ? <Bot className="size-4 text-muted-foreground" /> : <UserRound className="size-4 text-muted-foreground" />}
                <dd>{byAgent ? "Created by an agent run" : "Created by a user"}</dd>
              </div>
              {byAgent && provenance.approved_at && (
                <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /><dd>Approved {formatDateTime(provenance.approved_at)}</dd></div>
              )}
              {artifact.run_id && <div><dt className="sr-only">Run</dt><dd><Link href={`/agent-runs/${artifact.run_id}`} className="text-primary hover:underline">Open the agent run</Link></dd></div>}
            </dl>
          </section>
          <section className="rounded-xl border bg-background p-4">
            <h2 className="mb-3 text-sm font-semibold">Sources</h2>
            {!byAgent
              ? <p className="text-sm text-muted-foreground">User-authored artifacts have no verified sources.</p>
              : provenance.sources.length || provenance.data_references.length
                ? <SourceList sources={provenance.sources} dataReferences={provenance.data_references} />
                : <p className="text-sm text-muted-foreground">This report does not reference stored sources.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
