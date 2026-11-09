import { z } from "zod";
import { getWorkerEnv } from "../env.js";
import { getProvider } from "../providers/index.js";
import { searchRunEvidence } from "../queue/database.js";
import { defineTool, ToolInputError } from "./types.js";

export const searchDocumentsInputSchema = z.object({
  query: z.string().trim().min(1).max(2000).describe("Concise natural-language search query."),
  document_ids: z.array(z.guid()).max(20).optional().describe("Optional: restrict the search to these workspace documents."),
  top_k: z.number().int().min(1).max(12).default(6),
});

export const sourceSchema = z.object({
  chunk_id: z.guid(), document_id: z.guid(), file_name: z.string(),
  content: z.string(), similarity: z.number().nullable(), metadata: z.record(z.string(), z.unknown()),
});

export const searchDocumentsOutputSchema = z.object({
  sources: z.array(sourceSchema).max(12),
  search_mode: z.enum(["semantic", "full_text_demo"]),
});
export type SearchDocumentsOutput = z.infer<typeof searchDocumentsOutputSchema>;

const MAX_STORED_CONTENT = 1600;

export const searchDocumentsTool = defineTool({
  name: "search_documents",
  title: "Search workspace sources",
  description: "Search indexed document excerpts in this workspace. Returns snippets with chunk IDs you can cite.",
  stepType: "retrieval",
  inputSchema: searchDocumentsInputSchema,
  outputSchema: searchDocumentsOutputSchema,
  allowedRoles: ["admin", "member"],
  requiresApproval: false,
  /** Scope comes from the persisted run record, never from model output. */
  async execute(input, { run, signal, documentScope }) {
    // A task scope always applies; model-supplied IDs can only narrow it.
    const documentIds = documentScope
      ? (input.document_ids?.length ? input.document_ids.filter((id) => documentScope.includes(id)) : [...documentScope])
      : input.document_ids;
    if (documentScope && documentIds?.length === 0) {
      throw new ToolInputError("None of the requested documents are part of this task's selected documents.");
    }
    const embeddingProvider = getProvider("embedding");
    let embedding: number[] | undefined;
    if (!embeddingProvider.isDemo) {
      const generated = await embeddingProvider.generateEmbeddings([input.query], { signal });
      embedding = generated.value[0];
      if (!embedding || embedding.length !== getWorkerEnv().EMBEDDING_DIMENSIONS) {
        throw new Error("Query embeddings must match the workspace index dimensions.");
      }
    }
    const sources = await searchRunEvidence({
      organizationId: run.organization_id,
      workspaceId: run.workspace_id,
      query: input.query,
      embedding,
      limit: input.top_k,
      documentIds,
    });
    return {
      sources: sources.map((source) => ({ ...source, content: source.content.slice(0, MAX_STORED_CONTENT) })),
      search_mode: embedding ? "semantic" : "full_text_demo",
    };
  },
  summarize: (output) => output.sources.length
    ? `Found ${output.sources.length} matching source excerpts (${[...new Set(output.sources.map((source) => source.file_name))].join(", ")}).`
    : "No matching source excerpts were found.",
  evidenceFrom: (output) => output.sources,
});
