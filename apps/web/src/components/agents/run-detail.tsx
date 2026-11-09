"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Ban, Bot, Calculator, CheckCircle2, ChevronRight, CircleDashed, Clock3, FileSpreadsheet, FileText,
  ListChecks, LoaderCircle, PauseCircle, Search, ShieldCheck, ShieldX, Sparkles, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Markdown, JsonView } from "@/components/common/markdown";
import { LiveIndicator } from "@/components/common/live-indicator";
import { ErrorState } from "@/components/common/states";
import { StatusBadge, TERMINAL_RUN_STATUSES } from "@/components/common/status-badge";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunDetail } from "@/features/agent-runs/queries";
import { applyPushedEvent, buildRunView, eventLabel, isSeededDemo, mergeEvents, type RunView, type TimelineItem } from "@/features/agent-runs/view-model";
import { useRealtimeTable } from "@/hooks/use-realtime";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { formatCost, formatDateTime, formatDuration, formatInteger, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApprovalPanel } from "./approval-panel";
import { DemoBadge, SeededBadge } from "./runs-table";
import { SourceList } from "./source-list";

/** Fallback polling while the realtime channel is not live (normally updates arrive by push). */
const FALLBACK_POLL_MS = 10_000;
/** Safety net while live: a missed final event has no later event to reveal the gap. */
const LIVE_SAFETY_RESYNC_MS = 30_000;
/** Coalesces bursts of events (step_started + tool_call_started + …) into one refetch. */
const REFETCH_DEBOUNCE_MS = 250;

type RunEvent = RunDetail["events"][number];

const subscribeDesktop = (callback: () => void) => {
  const media = window.matchMedia("(min-width: 1280px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const useIsDesktop = () => useSyncExternalStore(subscribeDesktop, () => window.matchMedia("(min-width: 1280px)").matches, () => true);

export function RunDetailView({ initial, workspace, canApprove, canCancel }: {
  initial: RunDetail; workspace: { id: string; name: string } | null; canApprove: boolean; canCancel: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["run", initial.id] as const, [initial.id]);
  const runQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const fresh = (await apiFetch<RunDetail>(`/api/agent-runs/${initial.id}`)).data;
      // Never drop events already received by push (a refetch may race with realtime delivery).
      const cached = queryClient.getQueryData<RunDetail>(queryKey);
      return { ...fresh, events: mergeEvents(cached?.events ?? [], fresh.events) };
    },
    initialData: initial,
  });
  const run = runQuery.data;
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback((delay: number) => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void queryClient.invalidateQueries({ queryKey }), delay);
  }, [queryClient, queryKey]);
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  const status = useRealtimeTable<RunEvent>({
    channel: `run:${initial.id}`,
    table: "agent_run_events",
    event: "INSERT",
    filter: `run_id=eq.${initial.id}`,
    // The channel closes once the run reaches a terminal state.
    enabled: !terminal,
    onChange: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const event = payload.new;
      let gap = false;
      queryClient.setQueryData<RunDetail>(queryKey, (current) => {
        if (!current) return current;
        const applied = applyPushedEvent(current.events, event);
        gap = applied.gap;
        return { ...current, events: applied.events };
      });
      // Steps and run status are not in the event payload: refetch them. A sequence gap
      // means events were missed (e.g. during a reconnect), so resync immediately.
      scheduleRefetch(gap ? 0 : REFETCH_DEBOUNCE_MS);
    },
    onResync: () => scheduleRefetch(0),
  });
  // Fallback polling while reconnecting/offline, plus a slow safety resync while live.
  useEffect(() => {
    if (terminal || status === "connecting") return;
    const interval = setInterval(() => void queryClient.invalidateQueries({ queryKey }), status === "live" ? LIVE_SAFETY_RESYNC_MS : FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [terminal, status, queryClient, queryKey]);
  const view = useMemo(() => buildRunView(run, run.steps), [run]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const selectedStep = view.timeline.find((item) => item.id === selectedStepId) ?? null;
  const isDesktop = useIsDesktop();
  const active = !terminal;

  const timeline = <TimelinePanel view={view} events={run.events} selectedStepId={selectedStepId} onSelect={setSelectedStepId} />;
  const center = <ResultPanel run={run} view={view} />;
  const details = <DetailsPanel run={run} view={view} selectedStep={selectedStep} canApprove={canApprove} onClearStep={() => setSelectedStepId(null)} />;

  return (
    <div className="grid gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Link href="/agent-runs" className="hover:text-foreground hover:underline">Agent runs</Link>
            {workspace && <><ChevronRight className="size-3" /><Link href={`/workspaces/${workspace.id}/runs`} className="hover:text-foreground hover:underline">{workspace.name}</Link></>}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{run.title}</h1>
            <StatusBadge status={run.status} />
            {isSeededDemo(run.context) && <SeededBadge />}
            {view.isDemo && <DemoBadge />}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span>Created {formatDateTime(run.created_at)}</span>
            {active && <LiveIndicator status={status} />}
          </p>
        </div>
        {canCancel && active && <CancelRunButton runId={run.id} />}
      </header>

      <UsageStrip view={view} status={run.status} />
      {runQuery.isError && <ErrorState title="Live updates paused" description={`${errorMessage(runQuery.error)} Showing the last loaded state.`} />}

      {isDesktop ? (
        <div className="grid grid-cols-[300px_minmax(0,1fr)_360px] items-start gap-5">
          <aside className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">{timeline}</aside>
          <div className="min-w-0">{center}</div>
          <aside className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">{details}</aside>
        </div>
      ) : (
        <Tabs defaultValue={view.pendingApproval ? "details" : "result"}>
          <TabsList className="w-full">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="result">Result</TabsTrigger>
            <TabsTrigger value="details">{view.pendingApproval ? "Approval" : "Sources"}</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline" className="pt-4">{timeline}</TabsContent>
          <TabsContent value="result" className="pt-4">{center}</TabsContent>
          <TabsContent value="details" className="pt-4">{details}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function UsageStrip({ view, status }: { view: RunView; status: string }) {
  const items = [
    { label: "Model", value: view.usage.model ?? "—" },
    { label: "Tokens", value: `${formatInteger(view.usage.inputTokens)} in · ${formatInteger(view.usage.outputTokens)} out` },
    { label: "Estimated cost", value: formatCost(view.usage.estimatedCostUsd), hint: "Estimate from configured prices, not a provider invoice." },
    { label: "Steps", value: `${view.usage.steps} (${view.usage.toolCalls} tool calls)` },
    { label: "Duration", value: formatDuration(view.usage.startedAt, TERMINAL_RUN_STATUSES.has(status) ? view.usage.finishedAt : null) },
    { label: "Retries", value: String(view.usage.retries) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="bg-background px-4 py-3" title={item.hint}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ title, icon: Icon, children, action }: { title: string; icon: typeof ListChecks; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const toolIcons: Record<string, typeof Search> = { search_documents: Search, analyze_csv: FileSpreadsheet, calculate: Calculator, save_report: FileText };

function StepIcon({ item }: { item: TimelineItem }) {
  const className = "size-4";
  switch (item.status) {
    case "completed": return <CheckCircle2 className={cn(className, "text-success")} />;
    case "failed": return <XCircle className={cn(className, "text-destructive")} />;
    case "running": return <LoaderCircle className={cn(className, "animate-spin text-info")} />;
    case "waiting_approval": return <PauseCircle className={cn(className, "text-warning")} />;
    case "approved": return <ShieldCheck className={cn(className, "text-success")} />;
    case "rejected": return <ShieldX className={cn(className, "text-destructive")} />;
    case "cancelled": return <Ban className={cn(className, "text-muted-foreground")} />;
    default: return <CircleDashed className={cn(className, "text-muted-foreground")} />;
  }
}

function TimelinePanel({ view, events, selectedStepId, onSelect }: {
  view: RunView; events: RunDetail["events"]; selectedStepId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <Panel title="Execution timeline" icon={ListChecks}>
        {view.timeline.length === 0 ? <p className="text-sm text-muted-foreground">Waiting for the worker to start…</p> : (
          <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
            {view.timeline.map((item) => {
              const ToolIcon = item.toolName ? toolIcons[item.toolName] ?? Bot : null;
              return (
                <li key={item.id} className="relative">
                  <button type="button" onClick={() => onSelect(item.id)} aria-pressed={selectedStepId === item.id}
                    className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted", selectedStepId === item.id && "bg-muted")}>
                    <span className="relative z-10 mt-0.5 grid size-4 place-items-center rounded-full bg-background"><StepIcon item={item} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{item.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {ToolIcon && <ToolIcon className="size-3" />}
                        {item.toolName ?? item.type}
                        {item.startedAt && <> · {formatTime(item.startedAt)}</>}
                      </span>
                      {item.error && <span className="mt-1 line-clamp-2 block text-xs text-destructive">{item.error}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      <details className="rounded-xl border bg-background p-4">
        <summary className="cursor-pointer text-sm font-semibold">Event log <span className="font-normal text-muted-foreground">({events.length})</span></summary>
        <ol className="mt-3 space-y-1.5 font-mono text-xs">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2">
              <span className="w-6 shrink-0 text-right text-muted-foreground">{event.sequence}</span>
              <span className="min-w-0 flex-1 truncate">{eventLabel(event.event_type)}</span>
              <span className="shrink-0 text-muted-foreground">{formatTime(event.created_at)}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function ResultPanel({ run, view }: { run: RunDetail; view: RunView }) {
  const savedArtifacts = view.approvals.flatMap((approval) => {
    const id = approval.result?.artifact_id;
    return typeof id === "string" ? [{ id, title: approval.request.title }] : [];
  });
  const runningStep = [...view.timeline].reverse().find((item) => item.status === "running");

  return (
    <div className="grid gap-4">
      <Panel title="Objective" icon={Sparkles}><p className="whitespace-pre-wrap text-sm leading-relaxed">{run.objective}</p></Panel>

      {run.status === "failed" && (
        <ErrorState title={`Run failed${run.error_code ? ` (${run.error_code})` : ""}`} description={run.error_message ?? "The run stopped because of an error."} />
      )}
      {run.status === "cancelled" && <p className="flex items-center gap-2 rounded-xl border bg-muted/40 p-4 text-sm"><Ban className="size-4" />This run was cancelled. Completed steps remain available for review.</p>}
      {run.status === "queued" && run.retry_count > 0 && run.error_message && (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 p-4 text-sm"><Clock3 className="mt-0.5 size-4 shrink-0" />Retry scheduled after a temporary problem: {run.error_message}</p>
      )}

      <Panel title="Plan" icon={ListChecks}>
        {view.plan ? (
          <>
            <p className="text-sm text-muted-foreground">{view.plan.summary}</p>
            <ol className="mt-3 space-y-2">
              {view.plan.steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className="flex gap-3 text-sm">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{index + 1}</span>
                  <span><span className="font-medium">{step.title}</span><span className="block text-muted-foreground">{step.description}</span></span>
                </li>
              ))}
            </ol>
          </>
        ) : <p className="text-sm text-muted-foreground">{TERMINAL_RUN_STATUSES.has(run.status) ? "No plan was created." : "The agent is preparing a plan…"}</p>}
      </Panel>

      {!view.final && !TERMINAL_RUN_STATUSES.has(run.status) && (
        <div className="flex items-center gap-3 rounded-xl border bg-background p-4 text-sm">
          {run.status === "waiting_approval" ? <PauseCircle className="size-4 text-warning" /> : <LoaderCircle className="size-4 animate-spin text-info" />}
          <span>
            {run.status === "waiting_approval" ? "Paused until an authorized user decides the pending action."
              : runningStep ? `Working on: ${runningStep.title}` : run.status === "queued" ? "Waiting for a worker to pick up this run…" : "The agent is working…"}
          </span>
        </div>
      )}

      {view.final && (
        <Panel title="Final answer" icon={Bot}
          action={view.final.verified
            ? <span className="rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">Supported by sources</span>
            : <span className="flex items-center gap-1 rounded-full bg-warning/18 px-2 py-0.5 text-xs font-medium"><AlertTriangle className="size-3" />Not verified</span>}>
          <Markdown content={view.final.answer} />
          {view.isDemo && <p className="mt-3 text-xs text-muted-foreground">Produced by the deterministic demo provider, not by an AI model.</p>}
        </Panel>
      )}

      {savedArtifacts.length > 0 && (
        <Panel title="Saved reports" icon={FileText}>
          <ul className="space-y-1.5">{savedArtifacts.map((artifact) => <li key={artifact.id}><Link href={`/artifacts/${artifact.id}`} className="text-sm font-medium text-primary hover:underline">{artifact.title}</Link></li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

function DetailsPanel({ run, view, selectedStep, canApprove, onClearStep }: {
  run: RunDetail; view: RunView; selectedStep: TimelineItem | null; canApprove: boolean; onClearStep: () => void;
}) {
  const decided = view.approvals.filter((approval) => approval.status !== "waiting_approval");
  return (
    <div className="grid gap-4">
      {view.pendingApproval && (
        <ApprovalPanel runId={run.id} stepId={view.pendingApproval.stepId} request={view.pendingApproval.request} canDecide={canApprove} compact />
      )}

      {selectedStep && (
        <Panel title="Tool details" icon={Bot} action={<Button variant="ghost" size="xs" onClick={onClearStep}>Close</Button>}>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Step</dt><dd className="text-right font-medium">{selectedStep.title}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={selectedStep.status} /></dd></div>
            {selectedStep.toolName && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Tool</dt><dd className="font-mono text-xs">{selectedStep.toolName}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Duration</dt><dd className="tabular-nums">{formatDuration(selectedStep.startedAt, selectedStep.finishedAt)}</dd></div>
          </dl>
          {selectedStep.error && <p className="mt-3 rounded-md bg-destructive/8 p-2 text-sm text-destructive">{selectedStep.error}</p>}
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Input</p>
          <JsonView value={selectedStep.input} className="mt-1" />
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output</p>
          <JsonView value={selectedStep.output} className="mt-1" />
        </Panel>
      )}

      <Panel title="Sources" icon={Search}>
        <SourceList sources={view.sources} dataReferences={view.dataReferences} />
      </Panel>

      {decided.length > 0 && (
        <Panel title="Approval history" icon={ShieldCheck}>
          <ul className="space-y-2 text-sm">
            {decided.map((approval) => (
              <li key={approval.stepId} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{approval.request.action}</span><StatusBadge status={approval.decision?.decision ?? approval.status} /></div>
                {approval.approvedAt && <p className="mt-1 text-xs text-muted-foreground">Decided {formatDateTime(approval.approvedAt)}</p>}
                {approval.decision?.reason && <p className="mt-1 text-xs">“{approval.decision.reason}”</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {!selectedStep && view.timeline.length > 0 && <p className="text-xs text-muted-foreground">Select a step in the timeline to inspect its tool input and output.</p>}
    </div>
  );
}

function CancelRunButton({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/agent-runs/${runId}/cancel`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["run", runId] }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}><Ban />Cancel run</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
          <AlertDialogDescription>The agent stops at its next checkpoint and any pending approval is withdrawn. Completed steps stay in the history.</AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <LoaderCircle className="animate-spin" />}Cancel run</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
