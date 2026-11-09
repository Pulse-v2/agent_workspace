"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { FormError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalRequest } from "@/features/agent-runs/view-model";
import { locationOf } from "@/features/agent-runs/view-model";
import { apiFetch, errorMessage } from "@/lib/api/client";

/**
 * Shows exactly what will happen if the action is approved. The decision is
 * sent to the API; the worker re-reads and revalidates the stored action, so
 * nothing shown here (or sent from here) is executed directly.
 */
export function ApprovalPanel({ runId, stepId, request, canDecide, compact = false }: {
  runId: string; stepId: string; request: ApprovalRequest; canDecide: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: (decision: "approve" | "reject") => apiFetch(`/api/agent-runs/${runId}/steps/${stepId}/${decision}`, {
      method: "POST", json: reason.trim() ? { reason: reason.trim() } : {},
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      router.refresh();
    },
  });

  return (
    <section aria-label="Pending approval" className="min-w-0 rounded-xl border border-warning/50 bg-warning/5 p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Approval required: {request.action}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{request.expected_effect}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Report title</p>
          <p className="mt-0.5 text-sm font-medium">{request.title}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
          <div className={compact ? "mt-1 max-h-60 overflow-y-auto rounded-lg border bg-background p-3" : "mt-1 max-h-96 overflow-y-auto rounded-lg border bg-background p-3"}>
            <Markdown content={request.preview} />
            {request.preview_truncated && <p className="mt-2 text-xs text-muted-foreground">Preview truncated; the full report will be saved.</p>}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data and sources used</p>
          {request.sources.length === 0 && request.data_references.length === 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">No cited sources. The report is not backed by document excerpts.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {request.sources.map((source) => (
                <li key={source.chunk_id} className="rounded-md bg-background px-2.5 py-1.5">
                  <span className="font-medium">{source.file_name}</span>{locationOf(source.metadata) && <span className="text-muted-foreground"> · {locationOf(source.metadata)}</span>}
                  {source.snippet && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">“{source.snippet}”</span>}
                </li>
              ))}
              {request.data_references.map((reference, index) => (
                <li key={`${reference.document_id}-${index}`} className="rounded-md bg-background px-2.5 py-1.5">
                  <span className="font-medium">{reference.file_name}</span>
                  <span className="text-muted-foreground"> · {reference.operation}{reference.row_start !== null ? ` · rows ${reference.row_start}–${reference.row_end}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {canDecide ? (
        <div className="mt-4 grid gap-2">
          <Label htmlFor={`reason-${stepId}`} className="text-xs">Note <span className="font-normal text-muted-foreground">(optional, returned to the agent on rejection)</span></Label>
          <Textarea id={`reason-${stepId}`} rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
          <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => mutation.mutate("approve")} disabled={mutation.isPending}>
              {mutation.isPending && mutation.variables === "approve" ? <LoaderCircle className="animate-spin" /> : <Check />}Approve
            </Button>
            <Button variant="outline" onClick={() => mutation.mutate("reject")} disabled={mutation.isPending}>
              {mutation.isPending && mutation.variables === "reject" ? <LoaderCircle className="animate-spin" /> : <X />}Reject
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Only an organization admin or the member who started this run can decide.</p>
      )}
    </section>
  );
}
