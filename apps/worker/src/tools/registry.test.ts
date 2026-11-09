import { describe, expect, it } from "vitest";
import { getToolRegistry, ToolRegistry } from "./registry.js";
import { defineTool } from "./types.js";
import { z } from "zod";

describe("tool registry", () => {
  const registry = getToolRegistry();

  it("registers exactly the four agent tools", () => {
    expect(registry.names().sort()).toEqual(["analyze_csv", "calculate", "save_report", "search_documents"]);
  });

  it("requires approval only for save_report", () => {
    expect(registry.specs().filter((spec) => spec.requires_approval).map((spec) => spec.name)).toEqual(["save_report"]);
  });

  it("does not allow viewers to run any tool", () => {
    for (const name of registry.names()) expect(registry.get(name)!.allowedRoles).not.toContain("viewer");
  });

  it("publishes JSON schemas for every tool input", () => {
    for (const spec of registry.specs()) {
      expect(spec.input_schema).toMatchObject({ $schema: expect.any(String) });
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it("validates inputs with each tool's schema", () => {
    const search = registry.get("search_documents")!;
    expect(search.validateInput({ query: "revenue" })).toEqual({ success: true, data: { query: "revenue", top_k: 6 } });
    expect(search.validateInput({ query: "" })).toMatchObject({ success: false });
    expect(registry.get("save_report")!.validateInput({ title: "R" })).toMatchObject({ success: false, error: expect.stringContaining("content_markdown") });
  });

  it("returns null for unknown tools", () => {
    expect(registry.get("run_sql")).toBeNull();
  });

  it("rejects duplicate names and approval tools without an approval description", () => {
    const tool = defineTool({
      name: "x", title: "X", description: "Test tool for registry checks.", stepType: "tool",
      inputSchema: z.object({}), outputSchema: z.object({}), allowedRoles: ["admin"], requiresApproval: false,
      execute: async () => ({}), summarize: () => "ok",
    });
    expect(() => new ToolRegistry([tool, tool])).toThrow(/Duplicate/);
    expect(() => defineTool({
      name: "y", title: "Y", description: "Needs approval.", stepType: "tool",
      inputSchema: z.object({}), outputSchema: z.object({}), allowedRoles: ["admin"], requiresApproval: true,
      execute: async () => ({}), summarize: () => "ok",
    })).toThrow(/approval/);
  });

  it("validates tool outputs before returning them", async () => {
    const broken = defineTool({
      name: "broken", title: "Broken", description: "Returns an invalid output.", stepType: "tool",
      inputSchema: z.object({}), outputSchema: z.object({ value: z.number() }), allowedRoles: ["admin"], requiresApproval: false,
      execute: async () => ({ value: "not a number" } as unknown as { value: number }), summarize: () => "ok",
    });
    await expect(broken.run({}, {} as never)).rejects.toThrow();
  });
});
