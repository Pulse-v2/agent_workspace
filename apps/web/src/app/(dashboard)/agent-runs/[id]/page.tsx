import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RunDetailView } from "@/components/agents/run-detail";
import { getRunDetail } from "@/features/agent-runs/queries";
import { canApproveRun, requireAppContext } from "@/features/app/context";

export const metadata: Metadata = { title: "Agent run" };

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const context = await requireAppContext();
  // RLS (can_read_agent_run) decides visibility; a run from another organization is simply not found.
  const run = await getRunDetail(context, id);
  if (!run) notFound();
  const workspace = context.workspaces.find((item) => item.id === run.workspace_id) ?? null;
  const decider = canApproveRun(context, run.created_by);

  return (
    <RunDetailView
      initial={run}
      workspace={workspace ? { id: workspace.id, name: workspace.name } : null}
      canApprove={decider}
      canCancel={decider}
    />
  );
}
