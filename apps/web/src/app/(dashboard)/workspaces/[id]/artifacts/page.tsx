import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArtifactsListView, type ArtifactsSearchParams } from "@/components/artifacts/artifacts-list-view";
import { requireWorkspace } from "@/features/app/context";

export const metadata: Metadata = { title: "Artifacts" };

export default async function WorkspaceArtifactsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ArtifactsSearchParams> }) {
  const { id } = await params;
  const { context, workspace } = await requireWorkspace(id);
  if (!workspace) notFound();
  return <ArtifactsListView context={context} basePath={`/workspaces/${workspace.id}/artifacts`} searchParams={await searchParams} workspaceId={workspace.id} />;
}
