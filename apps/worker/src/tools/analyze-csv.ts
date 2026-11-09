import { z } from "zod";
import { loadCsvDataset } from "../queue/tool-data.js";
import { describeCsvResult } from "./csv/describe.js";
import { analyzeCsv, analyzeCsvInputSchema, CsvAnalysisError, type CsvOperationInput } from "./csv/analyze.js";
import { defineTool, ToolInputError } from "./types.js";

export const analyzeCsvOutputSchema = z.object({
  document_id: z.guid(),
  file_name: z.string(),
  operation: z.string(),
  rows_total: z.number().int(),
  rows_used: z.number().int(),
  row_start: z.number().int().nullable(),
  row_end: z.number().int().nullable(),
  columns: z.array(z.string()),
  result: z.json(),
  notes: z.array(z.string()),
});

const MAX_SUMMARY_CHARS = 1500;

export const analyzeCsvTool = defineTool({
  name: "analyze_csv",
  title: "Analyze dataset",
  description: "Run a predefined analysis (summary, missing_values, aggregation, group_by, trend, top_n) on an indexed CSV dataset. Use exact column names from the document list.",
  stepType: "tool",
  inputSchema: analyzeCsvInputSchema,
  outputSchema: analyzeCsvOutputSchema,
  allowedRoles: ["admin", "member"],
  requiresApproval: false,
  async execute(input, { run, documentScope }) {
    if (documentScope && !documentScope.includes(input.document_id)) {
      throw new ToolInputError("This dataset is not one of the documents selected for this task.");
    }
    const dataset = await loadCsvDataset(run, input.document_id);
    if ("error" in dataset) throw new ToolInputError(dataset.error);
    const { document_id: _documentId, ...operation } = input;
    try {
      const analysis = analyzeCsv(dataset.rows, operation as CsvOperationInput);
      return {
        document_id: dataset.document.id,
        file_name: dataset.document.file_name,
        operation: input.operation,
        ...analysis,
        result: JSON.parse(JSON.stringify(analysis.result)) as z.infer<typeof analyzeCsvOutputSchema>["result"],
      };
    } catch (error) {
      if (error instanceof CsvAnalysisError) throw new ToolInputError(error.message);
      throw error;
    }
  },
  summarize(output) {
    const range = output.row_start !== null ? `rows ${output.row_start}-${output.row_end}` : "no rows";
    const result = describeCsvResult(output.operation, output.result);
    return `${output.operation} on ${output.file_name} (${output.rows_used} of ${output.rows_total} rows, ${range}): ${result.slice(0, MAX_SUMMARY_CHARS)}${result.length > MAX_SUMMARY_CHARS ? "…" : ""}${output.notes.length ? ` Notes: ${output.notes.join(" ")}` : ""}`;
  },
  dataReferencesFrom: (output, stepId) => [{
    step_id: stepId,
    document_id: output.document_id,
    file_name: output.file_name,
    operation: output.operation,
    row_start: output.row_start,
    row_end: output.row_end,
    rows_used: output.rows_used,
    columns: output.columns,
  }],
});
