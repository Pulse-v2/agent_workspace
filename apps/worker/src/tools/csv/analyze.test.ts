import { describe, expect, it } from "vitest";
import { analyzeCsv, analyzeCsvInputSchema, CsvAnalysisError, parseNumber, type CsvRow } from "./analyze.js";

const rows: CsvRow[] = [
  { region: "EMEA", month: "2026-01-15", revenue: "1,000", units: "10" },
  { region: "APAC", month: "2026-01-20", revenue: "$800", units: "" },
  { region: "EMEA", month: "2026-02-10", revenue: "1200", units: "12" },
  { region: "AMER", month: "2026-02-11", revenue: "n/a", units: "7" },
  { region: "APAC", month: "2026-03-03", revenue: "950", units: "9" },
].map((data, index) => ({ index: index + 1, data }));

const parse = (input: unknown) => {
  const parsed = analyzeCsvInputSchema.parse({ document_id: "94000000-0000-4000-8000-000000000001", ...(input as object) });
  const { document_id: _documentId, ...operation } = parsed;
  return operation;
};

describe("parseNumber", () => {
  it.each([
    ["1,234.5", 1234.5], ["$1200", 1200], ["12%", 12], ["(300)", -300], ["-4e2", -400], [" 7 ", 7],
  ])("parses %s", (raw, expected) => expect(parseNumber(raw)).toBe(expected));

  it.each(["", "n/a", "abc", "1.2.3", "12,34"])("rejects %s", (raw) => expect(parseNumber(raw)).toBeNull());
});

describe("analyzeCsv", () => {
  it("summarizes column types and numeric stats", () => {
    const result = analyzeCsv(rows, parse({ operation: "summary" }));
    expect(result).toMatchObject({ rows_total: 5, rows_used: 5, row_start: 1, row_end: 5 });
    const columns = (result.result as { columns: Array<Record<string, unknown>> }).columns;
    expect(columns.find((column) => column.name === "month")).toMatchObject({ type: "date" });
    expect(columns.find((column) => column.name === "units")).toMatchObject({ type: "numeric", missing: 1, sum: 38 });
    expect(columns.find((column) => column.name === "revenue")).toMatchObject({ type: "numeric", missing: 1, sum: 3950 });
  });

  it("reports missing values with example rows", () => {
    const result = analyzeCsv(rows, parse({ operation: "missing_values" })).result as { rows_with_missing_values: number; example_rows: number[] };
    expect(result.rows_with_missing_values).toBe(2);
    expect(result.example_rows).toEqual([2, 4]);
  });

  it("aggregates with filters and reports the rows used", () => {
    const result = analyzeCsv(rows, parse({
      operation: "aggregation",
      aggregations: [{ column: "revenue", fn: "sum" }, { column: "revenue", fn: "count" }],
      filters: [{ column: "region", op: "eq", value: "emea" }],
    }));
    expect(result.result).toEqual({ "sum(revenue)": 2200, "count(revenue)": 2 });
    expect(result).toMatchObject({ rows_used: 2, row_start: 1, row_end: 3, columns: ["region", "revenue"] });
  });

  it("groups and sorts by the first aggregation", () => {
    const result = analyzeCsv(rows, parse({ operation: "group_by", group_by: "region", aggregations: [{ column: "revenue", fn: "sum" }] })).result as { groups: Array<Record<string, unknown>> };
    expect(result.groups.map((group) => [group.region, group["sum(revenue)"]])).toEqual([["EMEA", 2200], ["APAC", 1750], ["AMER", null]]);
    expect(result.groups[0]).toMatchObject({ rows: 2, row_start: 1, row_end: 3 });
  });

  it("computes monthly trends with period-over-period changes", () => {
    const result = analyzeCsv(rows, parse({ operation: "trend", period_column: "month", value_column: "revenue", period: "month" })).result as {
      series: Array<{ points: Array<{ period: string; value: number }>; change_abs: number; change_pct: number; largest_decrease: { to: string } }>;
    };
    const [series] = result.series;
    expect(series!.points.map((point) => [point.period, point.value])).toEqual([["2026-01", 1800], ["2026-02", 1200], ["2026-03", 950]]);
    expect(series!.change_abs).toBe(-850);
    expect(series!.largest_decrease.to).toBe("2026-02");
  });

  it("returns top rows with row indexes", () => {
    const result = analyzeCsv(rows, parse({ operation: "top_n", column: "revenue", n: 2, include_columns: ["region"] }));
    expect((result.result as { rows: unknown[] }).rows).toEqual([
      { row_index: 3, revenue: "1200", region: "EMEA" },
      { row_index: 1, revenue: "1,000", region: "EMEA" },
    ]);
  });

  it("rejects unknown columns with the available column names", () => {
    expect(() => analyzeCsv(rows, parse({ operation: "aggregation", aggregations: [{ column: "profit", fn: "sum" }] })))
      .toThrow(new CsvAnalysisError('Unknown column "profit". Available columns: region, month, revenue, units.'));
  });

  it("rejects unsupported operations at the schema level", () => {
    expect(analyzeCsvInputSchema.safeParse({ operation: "sql", document_id: "94000000-0000-4000-8000-000000000001", query: "drop table" }).success).toBe(false);
  });
});
