import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KnowledgeBase } from "@/components/documents/knowledge-base";
import { canContribute, isAdmin, requireWorkspace } from "@/features/app/context";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function WorkspaceDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();
  return <KnowledgeBase workspaceId={workspace.id} canUpload={canContribute(context.role)} canDelete={isAdmin(context.role)} />;
}
