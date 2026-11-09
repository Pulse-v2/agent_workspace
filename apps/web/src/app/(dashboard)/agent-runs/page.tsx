import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RunsListView, type RunsSearchParams } from "@/components/agents/runs-list-view";
import { LiveRefresh } from "@/components/common/live-refresh";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { canContribute, requireAppContext } from "@/features/app/context";

export const metadata: Metadata = { title: "Agent runs" };

export default async function AgentRunsPage({ searchParams }: { searchParams: Promise<RunsSearchParams> }) {
  const context = await requireAppContext();
  const firstWorkspace = context.workspaces[0];
  const newRunHref = canContribute(context.role) && firstWorkspace ? `/workspaces/${firstWorkspace.id}/runs/new` : null;
  return (
    <>
      <PageHeader title="Agent runs" description="Execution history across all workspaces in this organization."
        actions={<><LiveRefresh organizationId={context.organization.id} />{newRunHref && <Link href={newRunHref} className={buttonVariants()}><Plus />New agent task</Link>}</>} />
      <RunsListView context={context} basePath="/agent-runs" searchParams={await searchParams} newRunHref={newRunHref} />
    </>
  );
}
