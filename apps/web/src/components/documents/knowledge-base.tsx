"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, FileText, LoaderCircle, RotateCcw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState, type DragEvent } from "react";
import { LiveIndicator } from "@/components/common/live-indicator";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRealtimeTable } from "@/hooks/use-realtime";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, documentStatuses, extensionOf, MAX_DOCUMENT_BYTES } from "@/lib/validations/documents";

type DocumentRow = {
  id: string; workspace_id: string; uploaded_by: string; file_name: string; mime_type: string; size_bytes: number;
  processing_status: string; processing_error: string | null; embedding_status: string; created_at: string;
};
type DocumentDetail = DocumentRow & { checksum: string; chunk_count: number; row_count: number; download_url: string | null };
type UploadItem = { key: string; name: string; status: "pending" | "uploading" | "done" | "error"; message?: string };

const PROCESSING = new Set(["uploading", "queued", "processing"]);

export function KnowledgeBase({ workspaceId, canUpload, canDelete }: { workspaceId: string; canUpload: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDeferredValue(search.trim());

  const queryKey = ["documents", workspaceId, q, status] as const;
  const documents = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ workspaceId, pageSize: "100" });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      return (await apiFetch<DocumentRow[]>(`/api/documents?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });
  // Status changes arrive by push (documents table, RLS-filtered). Bursts are coalesced.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveStatus = useRealtimeTable({
    channel: `documents:${workspaceId}`,
    table: "documents",
    filter: `workspace_id=eq.${workspaceId}`,
    onChange: () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] }), 400);
    },
    onResync: () => void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] }),
  });
  const refetchDocuments = documents.refetch;
  const processing = documents.data?.some((document) => PROCESSING.has(document.processing_status)) ?? false;
  // Fallback polling only while the realtime channel is down and work is still in progress.
  useEffect(() => {
    if (liveStatus === "live" || liveStatus === "connecting" || !processing) return;
    const interval = setInterval(() => void refetchDocuments(), 5000);
    return () => clearInterval(interval);
  }, [liveStatus, processing, refetchDocuments]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    router.refresh();
  };

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    const items: UploadItem[] = files.map((file, index) => {
      const problem = !extensionOf(file.name) ? "Unsupported type. Use PDF, DOCX, TXT, Markdown, or CSV."
        : file.size === 0 || file.size > MAX_DOCUMENT_BYTES ? "Files must be between 1 byte and 50 MiB." : undefined;
      return { key: `${Date.now()}-${index}-${file.name}`, name: file.name, status: problem ? "error" : "pending", message: problem };
    });
    setUploads((current) => [...items, ...current].slice(0, 20));
    for (const [index, file] of files.entries()) {
      const item = items[index]!;
      if (item.status === "error") continue;
      const update = (patch: Partial<UploadItem>) => setUploads((current) => current.map((entry) => (entry.key === item.key ? { ...entry, ...patch } : entry)));
      update({ status: "uploading" });
      try {
        const body = new FormData();
        body.set("workspaceId", workspaceId);
        body.set("file", file);
        await apiFetch("/api/documents/upload", { method: "POST", body });
        update({ status: "done", message: "Queued for indexing" });
      } catch (error) {
        update({ status: "error", message: errorMessage(error) });
      }
    }
    invalidate();
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (canUpload) void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const retry = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/documents/${id}/retry`, { method: "POST" }),
    onSuccess: invalidate,
  });

  return (
    <div className="grid gap-6">
      {canUpload ? (
        <section
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn("rounded-xl border-2 border-dashed bg-background p-6 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
        >
          <input ref={inputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="sr-only" aria-label="Choose files to upload"
            onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
          <UploadCloud className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Drag and drop files here</p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, Markdown, or CSV · up to 50 MiB each · private to this organization</p>
          <Button variant="outline" className="mt-4" onClick={() => inputRef.current?.click()}>Choose files</Button>
          {uploads.length > 0 && (
            <ul className="mx-auto mt-5 max-w-xl space-y-1.5 text-left" aria-live="polite">
              {uploads.map((item) => (
                <li key={item.key} className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
                  {item.status === "uploading" || item.status === "pending" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    : item.status === "done" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <X className="size-4 shrink-0 text-destructive" />}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className={cn("shrink-0 text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>{item.message ?? (item.status === "pending" ? "Waiting" : "Uploading…")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground">You have read-only access. Admins and members can upload documents.</p>
      )}

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by file name" className="pl-8" aria-label="Search documents" />
          </div>
          <LiveIndicator status={liveStatus} className="sm:order-last" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"
            className="h-8 rounded-lg border bg-background px-2.5 text-sm">
            <option value="">All statuses</option>
            {documentStatuses.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
          </select>
        </div>

        {documents.isPending ? <ListSkeleton /> : documents.isError ? (
          <ErrorState description={errorMessage(documents.error)} action={<Button variant="outline" size="sm" onClick={() => void documents.refetch()}>Try again</Button>} />
        ) : documents.data.length === 0 ? (
          <EmptyState icon={FileText} title={q || status ? "No matching documents" : "No documents yet"}
            description={q || status ? "Try a different search or status filter." : "Uploaded sources appear here with their processing status."} />
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-background">
            {documents.data.map((document) => {
              const Icon = document.mime_type === "text/csv" ? FileSpreadsheet : FileText;
              return (
                <li key={document.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <button type="button" onClick={() => setSelected(document.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium hover:underline">{document.file_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatBytes(document.size_bytes)} · {formatRelative(document.created_at)}
                      {document.processing_status === "indexed" && (document.embedding_status === "completed" ? " · semantic search ready" : document.embedding_status === "unavailable" ? " · keyword search only (no embedding key)" : "")}
                    </span>
                    {document.processing_error && <span className="mt-0.5 block text-xs text-destructive">{document.processing_error}</span>}
                  </button>
                  <StatusBadge status={document.processing_status} />
                  <div className="flex items-center gap-1">
                    {document.processing_status === "failed" && canUpload && (
                      <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(document.id)}><RotateCcw />Retry</Button>
                    )}
                    {canDelete && <DeleteDocumentButton document={document} onDeleted={invalidate} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {retry.error && <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(retry.error)}</p>}
      </section>

      <DocumentDetailDialog documentId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DeleteDocumentButton({ document, onDeleted }: { document: DocumentRow; onDeleted: () => void }) {
  const mutation = useMutation({ mutationFn: () => apiFetch(`/api/documents/${document.id}`, { method: "DELETE" }), onSuccess: onDeleted });
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${document.file_name}`} />}><Trash2 /></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{document.file_name}”?</AlertDialogTitle>
          <AlertDialogDescription>The file and its search index are removed. Existing reports keep their stored source excerpts, but the original file can no longer be opened.</AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <LoaderCircle className="animate-spin" />}Delete document</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DocumentDetailDialog({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => (await apiFetch<DocumentDetail>(`/api/documents/${documentId}`)).data,
    enabled: Boolean(documentId),
    staleTime: 0, // signed URLs are short-lived
  });
  return (
    <Dialog open={Boolean(documentId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-all pr-6">{detail.data?.file_name ?? "Document"}</DialogTitle>
          <DialogDescription>Document details and index status.</DialogDescription>
        </DialogHeader>
        {detail.isPending ? <ListSkeleton rows={3} /> : detail.isError ? <ErrorState description={errorMessage(detail.error)} /> : (
          <div className="grid gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={detail.data.processing_status} /></dd>
              <dt className="text-muted-foreground">Type</dt><dd>{detail.data.mime_type}</dd>
              <dt className="text-muted-foreground">Size</dt><dd>{formatBytes(detail.data.size_bytes)}</dd>
              <dt className="text-muted-foreground">Uploaded</dt><dd>{formatDateTime(detail.data.created_at)}</dd>
              <dt className="text-muted-foreground">Chunks</dt><dd className="tabular-nums">{detail.data.chunk_count}</dd>
              {detail.data.row_count > 0 && <><dt className="text-muted-foreground">CSV rows</dt><dd className="tabular-nums">{detail.data.row_count}</dd></>}
              <dt className="text-muted-foreground">Embeddings</dt><dd className="capitalize">{detail.data.embedding_status}</dd>
              <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-xs">{detail.data.checksum}</dd>
            </dl>
            {detail.data.processing_error && <ErrorState title="Processing failed" description={detail.data.processing_error} />}
            {detail.data.download_url && (
              <a href={detail.data.download_url} className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary hover:underline" rel="noreferrer">
                <Download className="size-4" />Download original (link valid for 60 seconds)
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
