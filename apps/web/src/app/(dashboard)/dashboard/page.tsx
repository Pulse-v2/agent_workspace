import { Activity, CheckCircle2, Coins, FileText, FolderKanban, Plus, ShieldCheck, Workflow, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RunsTable } from "@/components/agents/runs-table";
import { LiveRefresh } from "@/components/common/live-refresh";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { RunsChart } from "@/components/dashboard/runs-chart";
import { QueueStatusCard } from "@/components/usage/queue-status-card";
import { getQueueStatus } from "@/features/usage/queries";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canContribute, requireAppContext } from "@/features/app/context";
import { eventLabel } from "@/features/agent-runs/view-model";
import { getDashboardData } from "@/features/dashboard/queries";
import { formatCompact, formatCost, formatInteger, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const context = await requireAppContext();
  const [data, queue] = await Promise.all([getDashboardData(context), getQueueStatus(context)]);
  const workspaceNames = new Map(context.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const firstWorkspace = context.workspaces[0];
  const contributor = canContribute(context.role);

  const stats = [
    { label: "Total runs", value: formatInteger(data.stats.totalRuns), hint: `${data.stats.active} active`, icon: Workflow },
    { label: "Completed", value: formatInteger(data.stats.completed), hint: data.stats.totalRuns ? `${Math.round((data.stats.completed / data.stats.totalRuns) * 100)}% of runs` : "No runs yet", icon: CheckCircle2 },
    { label: "Failed", value: formatInteger(data.stats.failed), hint: "Includes exhausted retries", icon: XCircle },
    { label: "Pending approvals", value: formatInteger(data.stats.pendingApprovals), hint: "Actions you can decide", icon: ShieldCheck, href: "/approvals" },
    { label: "Tokens used", value: formatCompact(data.stats.inputTokens + data.stats.outputTokens), hint: `${formatCompact(data.stats.inputTokens)} in · ${formatCompact(data.stats.outputTokens)} out`, icon: Activity },
    { label: "Estimated cost", value: formatCost(data.stats.estimatedCostUsd), hint: "Estimate, not an invoice", icon: Coins },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Agent activity in ${context.organization.name}${context.role === "admin" ? "" : " that is visible to you"}.`}
        actions={<>
          <LiveRefresh organizationId={context.organization.id} />
          {contributor && firstWorkspace && <Link href={`/workspaces/${firstWorkspace.id}/runs/new`} className={buttonVariants()}><Plus />New agent task</Link>}
        </>}
      />

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stats.map(({ label, value, hint, icon: Icon, href }) => {
          const body = (
            <Card size="sm" className="h-full">
              <CardHeader className="flex flex-row items-center justify-between"><CardDescription>{label}</CardDescription><Icon className="size-4 text-muted-foreground" /></CardHeader>
              <CardContent><p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent>
            </Card>
          );
          return href ? <Link key={label} href={href} className="rounded-xl transition-shadow hover:shadow-sm">{body}</Link> : <div key={label}>{body}</div>;
        })}
      </section>
      <div className="mt-3"><QueueStatusCard status={queue} /></div>
      {data.stats.truncated && <p className="mt-2 text-xs text-muted-foreground">Totals are computed from the 1,000 most recent runs.</p>}

      <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader><CardTitle>Runs over the last 14 days</CardTitle><CardDescription>By final status, using run creation date.</CardDescription></CardHeader>
          <CardContent><RunsChart data={data.daily} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Latest execution events.</CardDescription></CardHeader>
          <CardContent>
            {data.activity.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p> : (
              <ol className="space-y-3">
                {data.activity.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0 flex-1">
                      <p><span className="font-medium">{eventLabel(event.event_type)}</span> · <Link href={`/agent-runs/${event.run_id}`} className="text-muted-foreground hover:text-foreground hover:underline">{event.runTitle}</Link></p>
                      <p className="text-xs text-muted-foreground">{formatRelative(event.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Recent runs</h2><Link href="/agent-runs" className="text-sm text-primary hover:underline">View all</Link></div>
        {data.recentRuns.length ? <RunsTable runs={data.recentRuns} workspaceNames={workspaceNames} /> : (
          <EmptyState icon={Workflow} title="No agent runs yet"
            description="Start a task and the agent will show its plan, sources, and every tool action."
            action={contributor && firstWorkspace ? <Link href={`/workspaces/${firstWorkspace.id}/runs/new`} className={buttonVariants({ variant: "outline" })}><Plus />Create a task</Link> : null} />
        )}
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/workspaces", icon: FolderKanban, title: "Workspaces", detail: `${context.workspaces.length} in this organization` },
          { href: "/artifacts", icon: FileText, title: "Reports", detail: `${formatInteger(data.stats.artifacts)} saved artifacts` },
          { href: firstWorkspace ? `/workspaces/${firstWorkspace.id}/documents` : "/workspaces", icon: Activity, title: "Knowledge base", detail: `${formatInteger(data.stats.documents)} documents` },
        ].map(({ href, icon: Icon, title, detail }) => (
          <Link key={title} href={href} className="flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50">
            <span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Icon className="size-4" /></span>
            <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
          </Link>
        ))}
      </section>
    </>
  );
}
