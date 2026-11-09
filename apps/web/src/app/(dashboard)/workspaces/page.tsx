import { BookOpenText, FileText, FolderKanban, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceFormDialog } from "@/components/workspaces/workspace-form-dialog";
import { isAdmin, requireAppContext } from "@/features/app/context";
import { getAllWorkspaceCounts } from "@/features/workspaces/queries";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Workspaces" };

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  const context = await requireAppContext();
  const counts = await getAllWorkspaceCounts(context);
  const admin = isAdmin(context.role);
  const { create } = await searchParams;

  return (
    <>
      <PageHeader
        title="Workspaces"
        description={`All workspaces in ${context.organization.name}.`}
        actions={admin ? <WorkspaceFormDialog mode="create" organizationId={context.organization.id} defaultOpen={create === "1"} /> : null}
      />
      {!admin && <p className="-mt-3 mb-5 text-sm text-muted-foreground">Only organization admins can create or edit workspaces.</p>}
      {context.workspaces.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No workspaces yet" description={admin ? "Create a workspace to upload documents and run agents." : "An admin needs to create a workspace first."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {context.workspaces.map((workspace) => {
            const count = counts.get(workspace.id);
            return (
              <Link key={workspace.id} href={`/workspaces/${workspace.id}`} className="group rounded-xl focus-visible:outline-2">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FolderKanban className="size-4 text-muted-foreground" />{workspace.name}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-10">{workspace.description || "No description."}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5"><BookOpenText className="size-3.5" />{count?.documents ?? 0} documents</span>
                      <span className="flex items-center gap-1.5"><Workflow className="size-3.5" />{count?.runs ?? 0} runs</span>
                      <span className="flex items-center gap-1.5"><FileText className="size-3.5" />{count?.artifacts ?? 0} reports</span>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">Updated {formatRelative(workspace.updated_at)}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
