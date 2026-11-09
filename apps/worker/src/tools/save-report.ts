import { z } from "zod";
import { findExistingChunks, insertReportArtifact } from "../queue/tool-data.js";
import { defineTool, ToolInputError, type ToolContext } from "./types.js";

export const saveReportInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content_markdown: z.string().trim().min(1).max(50_000).describe("The full Markdown report."),
  artifact_type: z.enum(["report", "summary", "analysis"]).default("report"),
  source_chunk_ids: z.array(z.guid()).max(20).default([]).describe("Chunk IDs from search results that support the report."),
});

export const saveReportOutputSchema = z.object({
  artifact_id: z.guid(),
  title: z.string(),
  created: z.boolean(),
});

const PREVIEW_CHARS = 2000;

function resolveSources(sourceIds: string[], context: ToolContext) {
  const byId = new Map(context.evidence.map((item) => [item.chunk_id, item]));
  const unknown = sourceIds.filter((id) => !byId.has(id));
  if (unknown.length) {
    throw new ToolInputError(`The report cites ${unknown.length} chunk ID(s) that were not retrieved in this run. Cite only chunk IDs returned by search_documents.`);
  }
  return [...new Set(sourceIds)].map((id) => {
    const item = byId.get(id)!;
    return { chunk_id: item.chunk_id, document_id: item.document_id, file_name: item.file_name, snippet: item.content.slice(0, 300), metadata: item.metadata };
  });
}

export const saveReportTool = defineTool({
  name: "save_report",
  title: "Save report",
  description: "Save a final Markdown report as a workspace artifact. Requires user approval; the run pauses until an authorized user approves or rejects it.",
  stepType: "tool",
  inputSchema: saveReportInputSchema,
  outputSchema: saveReportOutputSchema,
  allowedRoles: ["admin", "member"],
  requiresApproval: true,
  describeApproval(input, context) {
    return {
      action: "Save report as a workspace artifact",
      title: input.title,
      preview: input.content_markdown.slice(0, PREVIEW_CHARS),
      preview_truncated: input.content_markdown.length > PREVIEW_CHARS,
      sources: resolveSources(input.source_chunk_ids, context),
      data_references: [...context.dataReferences],
      expected_effect: `Creates a new ${input.artifact_type} artifact "${input.title}" (${input.content_markdown.length.toLocaleString("en-US")} characters) in this workspace, visible to all workspace members. No external systems are contacted.`,
    };
  },
  async execute(input, context) {
    if (!context.approval) throw new Error("save_report executed without an approval record.");
    const sources = resolveSources(input.source_chunk_ids, context);
    // Revalidate against current data: cited chunks must still exist in this workspace.
    const existing = await findExistingChunks(context.run, sources.map((source) => source.chunk_id));
    const missing = sources.filter((source) => !existing.has(source.chunk_id));
    if (missing.length) throw new ToolInputError("Some cited sources were deleted after approval; the report was not saved.");

    const artifact = await insertReportArtifact({
      run: context.run,
      stepId: context.stepId,
      title: input.title,
      artifactType: input.artifact_type,
      contentMarkdown: input.content_markdown,
      approvedBy: context.approval.approvedBy,
      metadata: {
        generated_by: "agent",
        run_id: context.run.id,
        step_id: context.stepId,
        approved_by: context.approval.approvedBy,
        approved_at: context.approval.approvedAt,
        sources,
        data_references: context.dataReferences,
      },
    });
    return { artifact_id: artifact.id, title: input.title, created: artifact.created };
  },
  summarize: (output) => `Report "${output.title}" saved as workspace artifact ${output.artifact_id}.`,
});
