"use client";

import { ExternalLink, FileSpreadsheet, Quote } from "lucide-react";
import { useState } from "react";
import { DocumentDetailDialog } from "@/components/documents/knowledge-base";
import type { DataReference, SourceView } from "@/features/agent-runs/view-model";

/** Evidence the run retrieved. Cited sources are listed first; every item can open its original document. */
export function SourceList({ sources, dataReferences }: { sources: SourceView[]; dataReferences: DataReference[] }) {
  const [openDocument, setOpenDocument] = useState<string | null>(null);
  if (sources.length === 0 && dataReferences.length === 0) {
    return <p className="text-sm text-muted-foreground">No sources have been retrieved yet.</p>;
  }
  return (
    <>
      <ul className="space-y-2">
        {sources.map((source) => (
          <li key={source.chunk_id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{source.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {[source.location, source.similarity != null ? `similarity ${source.similarity.toFixed(2)}` : null].filter(Boolean).join(" · ") || "Excerpt"}
                </p>
              </div>
              {source.cited && <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">Cited</span>}
            </div>
            {source.quote && <p className="mt-2 flex gap-1.5 text-sm"><Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{source.quote}</span></p>}
            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-muted-foreground">{source.snippet ?? source.content}</p>
            <button type="button" onClick={() => setOpenDocument(source.document_id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ExternalLink className="size-3" />Open document
            </button>
          </li>
        ))}
        {dataReferences.map((reference, index) => (
          <li key={`${reference.document_id}-${reference.step_id ?? index}`} className="rounded-lg border bg-background p-3">
            <div className="flex items-center gap-2"><FileSpreadsheet className="size-4 text-muted-foreground" /><p className="truncate text-sm font-medium">{reference.file_name}</p></div>
            <p className="mt-1 text-xs text-muted-foreground">
              {reference.operation} · {reference.rows_used} rows used{reference.row_start !== null ? ` (rows ${reference.row_start}–${reference.row_end})` : ""}
              {reference.columns.length ? ` · ${reference.columns.slice(0, 6).join(", ")}` : ""}
            </p>
            <button type="button" onClick={() => setOpenDocument(reference.document_id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ExternalLink className="size-3" />Open dataset
            </button>
          </li>
        ))}
      </ul>
      <DocumentDetailDialog documentId={openDocument} onClose={() => setOpenDocument(null)} />
    </>
  );
}
