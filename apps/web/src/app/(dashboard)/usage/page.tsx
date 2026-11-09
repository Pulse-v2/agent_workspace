import { Activity, Clock, Coins, RotateCcw, Sparkles, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/common/status-badge";
import { LiveRefresh } from "@/components/common/live-refresh";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueueStatusCard } from "@/components/usage/queue-status-card";
import { CostChart, TokensChart } from "@/components/usage/usage-charts";
import { requireAppContext } from "@/features/app/context";
import { getQueueStatus, getUsageSummary, USAGE_PERIODS } from "@/features/usage/queries";
import { formatCompact, formatCost, formatInteger, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const context = await requireAppContext();
  const requested = Number((await searchParams).days);
  const days = USAGE_PERIODS.find((period) => period === requested) ?? 30;
  const [usage, queue] = await Promise.all([getUsageSummary(context, days), getQueueStatus(context)]);
  const workspaceNames = new Map(context.workspaces.map((workspace) => [workspace.id, workspace.name]));

  return (
    <>
      <PageHeader
        title="Usage"
        description={`Model usage and execution statistics for runs ${context.role === "admin" ? "in this organization" : "visible to you"}.`}
        actions={<>
          <LiveRefresh organizationId={context.organization.id} />
          <nav aria-label="Period" className="flex rounded-lg border bg-background p-0.5">
            {USAGE_PERIODS.map((period) => (
              <Link key={period} href={`/usage?days=${period}`} aria-current={period === days ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1 text-sm", period === days ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
                {period} days
              </Link>
            ))}
          </nav>
        </>}
      />

      {!usage ? <ErrorState description="Usage statistics could not be loaded." /> : (
        <div className="grid gap-5">
          <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              { label: "Runs", value: formatInteger(usage.totals.runs), hint: `${usage.totals.completed} completed · ${usage.totals.failed} failed`, icon: Workflow },
              { label: "Input tokens", value: formatCompact(usage.totals.input_tokens), hint: "Prompt tokens", icon: Activity },
              { label: "Output tokens", value: formatCompact(usage.totals.output_tokens), hint: "Completion tokens", icon: Activity },
              { label: "Estimated cost", value: formatCost(usage.totals.estimated_cost_usd), hint: "Estimate, not an invoice", icon: Coins },
              { label: "Avg. duration", value: usage.totals.avg_duration_seconds === null ? "—" : `${usage.totals.avg_duration_seconds}s`, hint: "Finished runs, wall clock", icon: Clock },
              { label: "Retries", value: formatInteger(usage.totals.retries), hint: `${usage.totals.demo_runs} demo runs`, icon: RotateCcw },
            ].map(({ label, value, hint, icon: Icon }) => (
              <Card key={label} size="sm">
                <CardHeader className="flex flex-row items-center justify-between"><CardDescription>{label}</CardDescription><Icon className="size-4 text-muted-foreground" /></CardHeader>
                <CardContent><p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent>
              </Card>
            ))}
          </section>

          <QueueStatusCard status={queue} />

          {usage.totals.runs === 0 ? (
            <EmptyState icon={Sparkles} title={`No runs in the last ${days} days`} description="Usage appears here once agent runs execute." />
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card><CardHeader><CardTitle>Tokens per day</CardTitle><CardDescription>Input and output tokens recorded by the worker.</CardDescription></CardHeader><CardContent><TokensChart daily={usage.daily} /></CardContent></Card>
                <Card><CardHeader><CardTitle>Estimated cost per day</CardTitle><CardDescription>From configured per-token prices. Not a provider invoice.</CardDescription></CardHeader><CardContent><CostChart daily={usage.daily} /></CardContent></Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>By model</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Model</TableHead><TableHead className="text-right">Runs</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Est. cost</TableHead></TableRow></TableHeader>
                      <TableBody>{usage.by_model.map((row) => (
                        <TableRow key={row.model}><TableCell className="font-mono text-xs">{row.model}{row.model === "demo-deterministic" && <span className="ml-2 font-sans text-muted-foreground">(demo)</span>}</TableCell><TableCell className="text-right tabular-nums">{row.runs}</TableCell><TableCell className="text-right tabular-nums">{formatCompact(row.tokens)}</TableCell><TableCell className="text-right tabular-nums">{formatCost(row.estimated_cost_usd)}</TableCell></TableRow>
                      ))}</TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>By workspace</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead className="text-right">Runs</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Est. cost</TableHead></TableRow></TableHeader>
                      <TableBody>{usage.by_workspace.map((row) => (
                        <TableRow key={row.workspace_id}><TableCell>{workspaceNames.get(row.workspace_id) ?? "Deleted workspace"}</TableCell><TableCell className="text-right tabular-nums">{row.runs}</TableCell><TableCell className="text-right tabular-nums">{formatCompact(row.tokens)}</TableCell><TableCell className="text-right tabular-nums">{formatCost(row.estimated_cost_usd)}</TableCell></TableRow>
                      ))}</TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Tool calls</CardTitle><CardDescription>Including failed and rejected calls.</CardDescription></CardHeader>
                  <CardContent>
                    {usage.tools.length === 0 ? <p className="text-sm text-muted-foreground">No tool calls yet.</p> : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Tool</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Failed</TableHead><TableHead className="text-right">Rejected</TableHead><TableHead className="text-right">Avg. time</TableHead></TableRow></TableHeader>
                        <TableBody>{usage.tools.map((row) => (
                          <TableRow key={row.tool_name}><TableCell className="font-mono text-xs">{row.tool_name}</TableCell><TableCell className="text-right tabular-nums">{row.calls}</TableCell><TableCell className="text-right tabular-nums">{row.failed}</TableCell><TableCell className="text-right tabular-nums">{row.rejected}</TableCell><TableCell className="text-right tabular-nums">{row.avg_duration_ms === null ? "—" : `${formatInteger(row.avg_duration_ms)} ms`}</TableCell></TableRow>
                        ))}</TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Failures</CardTitle><CardDescription>Failed runs by error code.</CardDescription></CardHeader>
                  <CardContent>
                    {usage.failures.length === 0 ? <p className="text-sm text-muted-foreground">No failed runs in this period.</p> : (
                      <ul className="divide-y">{usage.failures.map((row) => (
                        <li key={row.error_code} className="flex items-center justify-between py-2 text-sm"><span className="font-mono text-xs">{row.error_code}</span><span className="tabular-nums">{row.runs}</span></li>
                      ))}</ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle>Most expensive runs</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Est. cost</TableHead><TableHead className="text-right">Created</TableHead></TableRow></TableHeader>
                    <TableBody>{usage.top_runs.map((run) => (
                      <TableRow key={run.id}><TableCell><Link href={`/agent-runs/${run.id}`} className="font-medium hover:underline">{run.title}</Link></TableCell><TableCell><StatusBadge status={run.status} /></TableCell><TableCell className="text-right tabular-nums">{formatCompact(run.tokens)}</TableCell><TableCell className="text-right tabular-nums">{formatCost(run.estimated_cost_usd)}</TableCell><TableCell className="text-right text-muted-foreground">{formatRelative(run.created_at)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </>
  );
}
