"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileSpreadsheet, FileText, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormError } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

type DocumentOption = { id: string; file_name: string; mime_type: string; size_bytes: number; processing_status: string };

const formSchema = z.object({
  title: z.string().trim().min(1, "Give the task a short title.").max(160, "Use at most 160 characters."),
  objective: z.string().trim().min(10, "Describe the task in at least 10 characters.").max(12000, "Use at most 12,000 characters."),
});
type FormValues = z.infer<typeof formSchema>;

const EXAMPLE = "Analyze the uploaded sales reports, compare revenue performance across regions, identify unusual trends, and prepare a summary report with supporting sources.";

export function NewRunForm({ workspace, workspaces, documents, demoMode }: {
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
  documents: DocumentOption[];
  demoMode: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"compose" | "review">("compose");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { title: "", objective: "" } });
  const textDocuments = documents.filter((document) => document.mime_type !== "text/csv");
  const datasets = documents.filter((document) => document.mime_type === "text/csv");
  const selectedDocuments = documents.filter((document) => selected.has(document.id));

  const mutation = useMutation({
    mutationFn: (values: FormValues) => apiFetch<{ id: string }>("/api/agent-runs", {
      method: "POST",
      json: { workspaceId: workspace.id, ...values, documentIds: [...selected] },
    }),
    onSuccess: ({ data }) => router.push(`/agent-runs/${data.id}`),
  });

  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  if (step === "review") {
    const values = form.getValues();
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Review the task</CardTitle>
          <CardDescription>Nothing runs until you start it. You can cancel a run at any time, and saving reports always requires your approval.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <dl className="grid gap-4 text-sm">
            <div><dt className="text-muted-foreground">Workspace</dt><dd className="mt-0.5 font-medium">{workspace.name}</dd></div>
            <div><dt className="text-muted-foreground">Title</dt><dd className="mt-0.5 font-medium">{values.title}</dd></div>
            <div><dt className="text-muted-foreground">Objective</dt><dd className="mt-0.5 whitespace-pre-wrap rounded-lg bg-muted/60 p-3">{values.objective}</dd></div>
            <div>
              <dt className="text-muted-foreground">Sources</dt>
              <dd className="mt-1">
                {selectedDocuments.length ? (
                  <ul className="flex flex-wrap gap-1.5">{selectedDocuments.map((document) => <li key={document.id} className="rounded-md border px-2 py-1 text-xs">{document.file_name}</li>)}</ul>
                ) : <span>All indexed documents in this workspace</span>}
              </dd>
            </div>
          </dl>
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              The agent may search documents, analyze datasets, and calculate. Uploaded documents are treated as untrusted data. Limits on steps, duration, and estimated cost apply.
              {demoMode && " The worker runs in demo mode: results come from a deterministic demo provider, not a real AI model."}
            </p>
          </div>
          <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setStep("compose")} disabled={mutation.isPending}><ArrowLeft />Edit task</Button>
            <Button onClick={() => mutation.mutate(values)} disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle className="animate-spin" /> : <Play />}Start run
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(() => setStep("review"))} className="mx-auto grid max-w-3xl gap-6">
      <Card>
        <CardHeader><CardTitle>Task</CardTitle><CardDescription>Describe what you need. The agent writes a plan before it acts.</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="run-workspace">Workspace</Label>
            <select id="run-workspace" value={workspace.id} onChange={(event) => router.push(`/workspaces/${event.target.value}/runs/new`)}
              className="h-8 rounded-lg border bg-background px-2.5 text-sm">
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="run-title">Title</Label>
            <Input id="run-title" placeholder="Q3 regional revenue review" aria-invalid={Boolean(form.formState.errors.title)} {...form.register("title")} />
            <FormError message={form.formState.errors.title?.message} />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="run-objective">Objective</Label>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => form.setValue("objective", EXAMPLE, { shouldValidate: true })}>Use an example</button>
            </div>
            <Textarea id="run-objective" rows={6} placeholder="What should the agent find out or produce?" aria-invalid={Boolean(form.formState.errors.objective)} {...form.register("objective")} />
            <FormError message={form.formState.errors.objective?.message} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources <span className="text-sm font-normal text-muted-foreground">(optional)</span></CardTitle>
          <CardDescription>Limit the agent to specific documents and datasets. Leave everything unselected to use all indexed documents.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <DocumentPicker title="Relevant documents" icon={FileText} documents={textDocuments} selected={selected} onToggle={toggle} empty="No text documents in this workspace." />
          <DocumentPicker title="Datasets" icon={FileSpreadsheet} documents={datasets} selected={selected} onToggle={toggle} empty="No CSV datasets in this workspace." />
        </CardContent>
      </Card>

      <div className="flex justify-end"><Button type="submit">Review task<ArrowRight /></Button></div>
    </form>
  );
}

function DocumentPicker({ title, icon: Icon, documents, selected, onToggle, empty }: {
  title: string; icon: typeof FileText; documents: DocumentOption[]; selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void; empty: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</legend>
      {documents.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {documents.map((document) => {
            const ready = document.processing_status === "indexed";
            const id = `document-${document.id}`;
            return (
              <li key={document.id}>
                <label htmlFor={id} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2", ready ? "cursor-pointer hover:bg-muted/50" : "opacity-60")}>
                  <Checkbox id={id} checked={selected.has(document.id)} disabled={!ready} onCheckedChange={(checked) => onToggle(document.id, Boolean(checked))} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{document.file_name}</span><span className="text-xs text-muted-foreground">{formatBytes(document.size_bytes)}</span></span>
                  {!ready && <StatusBadge status={document.processing_status} compact />}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
