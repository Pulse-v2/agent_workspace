import { FlaskConical, Sparkles } from "lucide-react";
import { isSeededDemo } from "@/features/agent-runs/view-model";
import Link from "next/link";
import { StatusBadge } from "@/components/common/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompact, formatCost, formatDuration, formatRelative } from "@/lib/format";

type RunListItem = {
  id: string; title: string; status: string; workspace_id: string; model: string | null;
  input_tokens: number; output_tokens: number; estimated_cost_usd: number | string;
  created_at: string; started_at: string | null; finished_at: string | null; context?: unknown;
};

export function SeededBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-info/12 px-1.5 py-0.5 text-[10px] font-medium text-info" title="Created by the demo seed script"><FlaskConical className="size-3" />Seeded demo</span>;
}

export function DemoBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="Produced by the deterministic demo provider, not a real AI model"><Sparkles className="size-3" />Demo</span>;
}

export function RunsTable({ runs, workspaceNames, showWorkspace = true }: { runs: RunListItem[]; workspaceNames?: Map<string, string>; showWorkspace?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            {showWorkspace && <TableHead className="hidden md:table-cell">Workspace</TableHead>}
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Tokens</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Est. cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Duration</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} className="relative">
              <TableCell className="max-w-[320px]">
                <Link href={`/agent-runs/${run.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                  <span className="line-clamp-1">{run.title}</span>
                </Link>
                {(run.model === "demo-deterministic" || isSeededDemo(run.context)) && (
                  <span className="mt-1 flex gap-1">{isSeededDemo(run.context) && <SeededBadge />}{run.model === "demo-deterministic" && <DemoBadge />}</span>
                )}
              </TableCell>
              {showWorkspace && <TableCell className="hidden text-muted-foreground md:table-cell">{workspaceNames?.get(run.workspace_id) ?? "—"}</TableCell>}
              <TableCell><StatusBadge status={run.status} /></TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatCompact(run.input_tokens + run.output_tokens)}</TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatCost(run.estimated_cost_usd)}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatDuration(run.started_at, run.finished_at)}</TableCell>
              <TableCell className="text-right text-muted-foreground" title={run.created_at}>{formatRelative(run.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
