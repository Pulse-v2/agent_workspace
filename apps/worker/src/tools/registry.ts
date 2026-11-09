import { analyzeCsvTool } from "./analyze-csv.js";
import { calculateTool } from "./calculate.js";
import { saveReportTool } from "./save-report.js";
import { searchDocumentsTool } from "./search-documents.js";
import type { ToolSpec } from "../providers/types.js";
import type { RegisteredTool } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(tools: RegisteredTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string) {
    return this.tools.get(name) ?? null;
  }

  names() {
    return [...this.tools.keys()];
  }

  specs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      requires_approval: tool.requiresApproval,
      input_schema: tool.inputJsonSchema,
    }));
  }
}

let registry: ToolRegistry | undefined;

/** The only tools the agent can run. Model output can select from these names and nothing else. */
export function getToolRegistry() {
  registry ??= new ToolRegistry([searchDocumentsTool, analyzeCsvTool, calculateTool, saveReportTool]);
  return registry;
}
