import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalPanel } from "@/components/agents/approval-panel";
import { LiveRefresh } from "@/components/common/live-refresh";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { listPendingApprovals } from "@/features/agent-runs/queries";
import { approvalRequestSchema } from "@/features/agent-runs/view-model";
import { requireAppContext } from "@/features/app/context";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const context = await requireAppContext();
  const pending = await listPendingApprovals(context);
  const workspaceNames = new Map(context.workspaces.map((workspace) => [workspace.id, workspace.name]));

  return (
    <>
      <PageHeader title="Approvals" actions={<LiveRefresh organizationId={context.organization.id} />}
        description={context.role === "admin"
          ? "Actions in this organization that are waiting for a decision."
          : "Actions in runs you started that are waiting for your decision."} />
      {pending.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing to review" description="When an agent wants to save a report or take another approval-required action, it will appear here." />
      ) : (
        <div className="grid gap-5">
          {pending.map(({ step, run }) => {
            const request = approvalRequestSchema.safeParse((step.output_json as { approval?: unknown } | null)?.approval);
            return (
              <article key={step.id} className="grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link href={`/agent-runs/${run.id}`} className="text-base font-semibold hover:underline">{run.title}</Link>
                    <p className="text-sm text-muted-foreground">{workspaceNames.get(run.workspace_id) ?? "Workspace"} · requested {formatRelative(step.created_at)} · tool <span className="font-mono text-xs">{step.tool_name}</span></p>
                  </div>
                  <Link href={`/agent-runs/${run.id}`} className="text-sm text-primary hover:underline">Open run</Link>
                </div>
                {request.success
                  ? <ApprovalPanel runId={run.id} stepId={step.id} request={request.data} canDecide />
                  : <ErrorState title="Preview unavailable" description="The pending action could not be displayed. Open the run to inspect it." />}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
