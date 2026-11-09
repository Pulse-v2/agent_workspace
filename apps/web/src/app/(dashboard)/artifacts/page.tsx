import type { Metadata } from "next";
import { ArtifactsListView, type ArtifactsSearchParams } from "@/components/artifacts/artifacts-list-view";
import { PageHeader } from "@/components/common/page-header";
import { requireAppContext } from "@/features/app/context";

export const metadata: Metadata = { title: "Reports" };

export default async function ArtifactsPage({ searchParams }: { searchParams: Promise<ArtifactsSearchParams> }) {
  const context = await requireAppContext();
  return (
    <>
      <PageHeader title="Reports" description="Saved reports and artifacts across your workspaces." />
      <ArtifactsListView context={context} basePath="/artifacts" searchParams={await searchParams} />
    </>
  );
}
