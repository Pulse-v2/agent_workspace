import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LiveRefresh } from "@/components/common/live-refresh";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DeleteWorkspaceButton } from "@/components/workspaces/delete-workspace-button";
import { WorkspaceFormDialog } from "@/components/workspaces/workspace-form-dialog";
import { WorkspaceTabs } from "@/components/workspaces/workspace-tabs";
import { canContribute, isAdmin, requireWorkspace } from "@/features/app/context";
import { getWorkspaceCounts } from "@/features/workspaces/queries";

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();
  const counts = await getWorkspaceCounts(context, workspace.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Workspaces", href: "/workspaces" }, { label: workspace.name }]}
        title={workspace.name}
        description={workspace.description || undefined}
        actions={<>
          <LiveRefresh organizationId={context.organization.id} workspaceId={workspace.id} />
          {isAdmin(context.role) && <WorkspaceFormDialog mode="edit" workspace={workspace} />}
          {isAdmin(context.role) && <DeleteWorkspaceButton workspace={workspace} />}
          {canContribute(context.role) && <Link href={`/workspaces/${workspace.id}/runs/new`} className={buttonVariants()}><Plus />New agent task</Link>}
        </>}
      />
      <WorkspaceTabs workspaceId={workspace.id} counts={counts} />
      {children}
    </>
  );
}
