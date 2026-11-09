import {
  AlertCircle, Ban, CheckCircle2, CircleDashed, Clock3, LoaderCircle, PauseCircle, ShieldCheck, ShieldX, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type StatusConfig = { label: string; tone: Tone; icon: LucideIcon; spin?: boolean };

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/18 text-foreground",
  danger: "bg-destructive/12 text-destructive",
};

const statuses: Record<string, StatusConfig> = {
  // Runs
  queued: { label: "Queued", tone: "neutral", icon: Clock3 },
  planning: { label: "Planning", tone: "info", icon: LoaderCircle, spin: true },
  running: { label: "Running", tone: "info", icon: LoaderCircle, spin: true },
  waiting_approval: { label: "Waiting for approval", tone: "warning", icon: PauseCircle },
  completed: { label: "Completed", tone: "success", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "danger", icon: AlertCircle },
  cancelled: { label: "Cancelled", tone: "neutral", icon: Ban },
  // Steps
  approved: { label: "Approved", tone: "success", icon: ShieldCheck },
  rejected: { label: "Rejected", tone: "danger", icon: ShieldX },
  // Documents
  uploading: { label: "Uploading", tone: "neutral", icon: LoaderCircle, spin: true },
  processing: { label: "Processing", tone: "info", icon: LoaderCircle, spin: true },
  indexed: { label: "Indexed", tone: "success", icon: CheckCircle2 },
};

export function StatusBadge({ status, className, compact = false }: { status: string; className?: string; compact?: boolean }) {
  const config = statuses[status] ?? { label: status, tone: "neutral" as const, icon: CircleDashed };
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", tones[config.tone], className)}>
      <Icon className={cn("size-3.5", config.spin && "animate-spin")} aria-hidden />
      {compact ? <span className="sr-only">{config.label}</span> : config.label}
    </span>
  );
}

export const ACTIVE_RUN_STATUSES = new Set(["queued", "planning", "running"]);
export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
