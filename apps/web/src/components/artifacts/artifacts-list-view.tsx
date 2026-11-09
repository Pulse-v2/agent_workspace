import { Bot, ChevronLeft, ChevronRight, FileText, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/states";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppContext } from "@/features/app/context";
import { listArtifacts } from "@/features/artifacts/queries";
import { formatRelative } from "@/lib/format";

export type ArtifactsSearchParams = { q?: string; workspace?: string; page?: string };

export async function ArtifactsListView({ context, basePath, searchParams, workspaceId }: {
  context: AppContext; basePath: string; searchParams: ArtifactsSearchParams; workspaceId?: string;
}) {
  const q = searchParams.q?.trim().slice(0, 200) || undefined;
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const workspaceFilter = workspaceId ?? context.workspaces.find((workspace) => workspace.id === searchParams.workspace)?.id;
  const result = await listArtifacts(context, { workspaceId: workspaceFilter, q, page });
  const workspaceNames = new Map(context.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const filtered = Boolean(q || (!workspaceId && workspaceFilter));
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (!workspaceId && workspaceFilter) params.set("workspace", workspaceFilter);
    if (nextPage > 1) params.set("page", String(nextPage));
    return params.size ? `${basePath}?${params}` : basePath;
  };

  return (
    <div className="grid gap-4">
      <form method="get" action={basePath} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search by title" className="pl-8" aria-label="Search reports" />
        </div>
        {!workspaceId && (
          <select name="workspace" defaultValue={workspaceFilter ?? ""} aria-label="Filter by workspace" className="h-8 rounded-lg border bg-background px-2.5 text-sm">
            <option value="">All workspaces</option>
            {context.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        )}
        <button type="submit" className={buttonVariants({ variant: "outline" })}>Apply</button>
        {filtered && <Link href={basePath} className={buttonVariants({ variant: "ghost" })}>Reset</Link>}
      </form>

      {result.rows.length === 0 ? (
        <EmptyState icon={FileText} title={filtered ? "No reports match" : "No reports yet"}
          description={filtered ? "Try another title or workspace." : "Reports appear here after an agent run saves one and the action is approved."} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.rows.map((artifact) => {
            const metadata = (artifact.metadata ?? {}) as { sources?: unknown[]; data_references?: unknown[] };
            // Agent provenance comes from source_step_id, which only the worker can set (metadata is user-editable).
            const byAgent = artifact.source_step_id !== null;
            const sourceCount = (metadata.sources?.length ?? 0) + (metadata.data_references?.length ?? 0);
            return (
              <li key={artifact.id}>
                <Link href={`/artifacts/${artifact.id}`} className="flex h-full flex-col rounded-xl border bg-background p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="line-clamp-2 text-sm font-semibold">{artifact.title}</p>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{workspaceNames.get(artifact.workspace_id) ?? "Workspace"} · <span className="capitalize">{artifact.artifact_type}</span> · {formatRelative(artifact.created_at)}</p>
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground">
                    {byAgent ? <><Bot className="size-3.5" />Agent report, approved</> : <><UserRound className="size-3.5" />Created by a user</>}
                    {sourceCount > 0 && <> · {sourceCount} source{sourceCount === 1 ? "" : "s"}</>}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {page > 1 && <Link href={hrefFor(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft />Previous</Link>}
          <span className="tabular-nums">Page {page} of {pages}</span>
          {page < pages && <Link href={hrefFor(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next<ChevronRight /></Link>}
        </div>
      )}
    </div>
  );
}
