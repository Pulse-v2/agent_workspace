import { describe, expect, it } from "vitest";
import { analyzeCsv } from "./analyze.js";
import { describeCsvResult } from "./describe.js";

const rows = [
  { region: "EMEA", revenue: "100" },
  { region: "APAC", revenue: "80" },
  { region: "EMEA", revenue: "120" },
].map((data, index) => ({ index: index + 1, data }));

describe("describeCsvResult", () => {
  it("describes a summary in words, without raw JSON", () => {
    const text = describeCsvResult("summary", analyzeCsv(rows, { operation: "summary" }).result);
    expect(text).toBe("3 rows, 2 columns: region (text, 2 distinct: EMEA, APAC); revenue (numeric: min 80, max 120, mean 100, sum 300).");
  });

  it("describes groups and aggregations", () => {
    const grouped = analyzeCsv(rows, { operation: "group_by", group_by: "region", aggregations: [{ column: "revenue", fn: "sum" }], filters: [], limit: 25 }).result;
    expect(describeCsvResult("group_by", grouped)).toBe("2 groups sorted by sum(revenue): region EMEA, rows 2, sum(revenue) 220 | region APAC, rows 1, sum(revenue) 80.");
    expect(describeCsvResult("aggregation", { "sum(revenue)": 300, "count(revenue)": 3 })).toBe("sum(revenue) = 300; count(revenue) = 3.");
  });

  it("falls back to compact JSON for unexpected shapes", () => {
    expect(describeCsvResult("unknown", { a: 1 })).toBe('{"a":1}');
    expect(describeCsvResult("summary", null)).toBe("null");
  });
});
