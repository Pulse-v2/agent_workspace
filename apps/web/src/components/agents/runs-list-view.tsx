import { agentRunStatuses, type AgentRunStatus } from "@ai-agent/shared";
import { ChevronLeft, ChevronRight, Plus, Search, Workflow } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/states";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listRuns } from "@/features/agent-runs/queries";
import type { AppContext } from "@/features/app/context";
import { RunsTable } from "./runs-table";

export type RunsSearchParams = { status?: string; q?: string; page?: string; workspace?: string };

const statusLabels: Record<AgentRunStatus, string> = {
  queued: "Queued", planning: "Planning", running: "Running", waiting_approval: "Waiting for approval",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

/** Server-rendered, filterable run history. Filters are plain GET params so they work without JavaScript and are shareable. */
export async function RunsListView({ context, basePath, searchParams, workspaceId, newRunHref }: {
  context: AppContext; basePath: string; searchParams: RunsSearchParams; workspaceId?: string; newRunHref?: string | null;
}) {
  const status = agentRunStatuses.find((value) => value === searchParams.status);
  const q = searchParams.q?.trim().slice(0, 200) || undefined;
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const workspaceFilter = workspaceId ?? context.workspaces.find((workspace) => workspace.id === searchParams.workspace)?.id;
  const result = await listRuns(context, { workspaceId: workspaceFilter, status, q, page, pageSize: 20 });
  const workspaceNames = new Map(context.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (!workspaceId && workspaceFilter) params.set("workspace", workspaceFilter);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const filtered = Boolean(status || q || (!workspaceId && workspaceFilter));

  return (
    <div className="grid gap-4">
      <form method="get" action={basePath} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search by task title" className="pl-8" aria-label="Search runs" />
        </div>
        {!workspaceId && (
          <select name="workspace" defaultValue={workspaceFilter ?? ""} aria-label="Filter by workspace" className="h-8 rounded-lg border bg-background px-2.5 text-sm">
            <option value="">All workspaces</option>
            {context.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        )}
        <select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-8 rounded-lg border bg-background px-2.5 text-sm">
          <option value="">All statuses</option>
          {agentRunStatuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
        </select>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>Apply</button>
        {filtered && <Link href={basePath} className={buttonVariants({ variant: "ghost" })}>Reset</Link>}
      </form>

      {result.rows.length === 0 ? (
        <EmptyState icon={Workflow} title={filtered ? "No runs match these filters" : "No agent runs yet"}
          description={filtered ? "Try another status or search term." : "Runs you start appear here with their status, usage, and results."}
          action={!filtered && newRunHref ? <Link href={newRunHref} className={buttonVariants({ variant: "outline" })}><Plus />New agent task</Link> : null} />
      ) : (
        <>
          <RunsTable runs={result.rows} workspaceNames={workspaceNames} showWorkspace={!workspaceId} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{result.total} run{result.total === 1 ? "" : "s"}{context.role !== "admin" && " visible to you"}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                {page > 1 ? <Link href={hrefFor(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft />Previous</Link> : null}
                <span className="tabular-nums">Page {page} of {pages}</span>
                {page < pages ? <Link href={hrefFor(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next<ChevronRight /></Link> : null}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
