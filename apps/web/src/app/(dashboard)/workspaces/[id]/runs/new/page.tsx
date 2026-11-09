import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewRunForm } from "@/components/agents/new-run-form";
import { ErrorState } from "@/components/common/states";
import { canContribute, requireWorkspace } from "@/features/app/context";

export const metadata: Metadata = { title: "New agent task" };

export default async function NewRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();
  if (!canContribute(context.role)) {
    return <ErrorState title="You cannot start agent runs" description="Viewers can read runs and reports. Ask an admin for member access to run agents." />;
  }
  const { data: documents } = await context.supabase.from("documents")
    .select("id, file_name, mime_type, size_bytes, processing_status")
    .eq("workspace_id", workspace.id).order("file_name").limit(200);

  return (
    <NewRunForm
      workspace={workspace}
      workspaces={context.workspaces.map(({ id: workspaceId, name }) => ({ id: workspaceId, name }))}
      documents={documents ?? []}
      demoMode={process.env.DEMO_MODE === "true"}
    />
  );
}
