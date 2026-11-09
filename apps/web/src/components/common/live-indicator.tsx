import type { LiveStatus } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";

const labels: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline · refreshing periodically",
};

export function LiveIndicator({ status, className }: { status: LiveStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} role="status" aria-live="polite">
      <span className={cn("size-2 rounded-full", status === "live" ? "bg-success" : status === "offline" ? "bg-muted-foreground/50" : "animate-pulse bg-warning")} />
      {labels[status]}
    </span>
  );
}
