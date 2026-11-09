import { Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { QueueStatus } from "@/features/usage/queries";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Queue depth for this organization plus anonymous worker liveness. */
export function QueueStatusCard({ status }: { status: QueueStatus | null }) {
  if (!status) return null;
  const online = status.workers_online > 0;
  const waiting = status.agent_runs_queued + status.documents_queued;
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle>Processing</CardTitle><CardDescription>Background workers and this organization’s queue.</CardDescription></div>
        <Cpu className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", online ? "bg-success" : "bg-destructive")} />
          {online ? `${status.workers_online} worker${status.workers_online === 1 ? "" : "s"} online` : "No worker online"}
          {status.last_worker_heartbeat_at && <span className="text-muted-foreground">· last heartbeat {formatRelative(status.last_worker_heartbeat_at)}</span>}
        </p>
        <p className="text-muted-foreground">
          Agent runs: {status.agent_runs_running} running, {status.agent_runs_queued} queued · Documents: {status.documents_running} processing, {status.documents_queued} queued
        </p>
        {waiting > 0 && status.oldest_queued_seconds !== null && (
          <p className={cn("text-xs", !online ? "text-destructive" : "text-muted-foreground")}>
            Oldest waiting job: {Math.round(status.oldest_queued_seconds)} s{!online && " — start a worker to process the queue"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
