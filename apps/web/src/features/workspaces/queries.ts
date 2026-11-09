import type { AppContext } from "@/features/app/context";

export type WorkspaceCounts = { documents: number; runs: number; artifacts: number };

export async function getWorkspaceCounts(context: AppContext, workspaceId: string): Promise<WorkspaceCounts> {
  const count = async (table: "documents" | "agent_runs" | "artifacts") => {
    const { count: total } = await context.supabase.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    return total ?? 0;
  };
  const [documents, runs, artifacts] = await Promise.all([count("documents"), count("agent_runs"), count("artifacts")]);
  return { documents, runs, artifacts };
}

export async function getAllWorkspaceCounts(context: AppContext) {
  const entries = await Promise.all(context.workspaces.map(async (workspace) => [workspace.id, await getWorkspaceCounts(context, workspace.id)] as const));
  return new Map(entries);
}
