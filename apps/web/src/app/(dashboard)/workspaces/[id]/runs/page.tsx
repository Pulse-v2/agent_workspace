import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunsListView, type RunsSearchParams } from "@/components/agents/runs-list-view";
import { canContribute, requireWorkspace } from "@/features/app/context";

export const metadata: Metadata = { title: "Agent runs" };

export default async function WorkspaceRunsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RunsSearchParams> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();
  return (
    <RunsListView context={context} basePath={`/workspaces/${workspace.id}/runs`} searchParams={await searchParams} workspaceId={workspace.id}
      newRunHref={canContribute(context.role) ? `/workspaces/${workspace.id}/runs/new` : null} />
  );
}
