import { z } from "zod";

/**
 * Predefined, validated CSV operations over parsed rows. Model input only
 * selects an operation and column names; nothing is compiled into SQL or code.
 */

export class CsvAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvAnalysisError";
  }
}

export type CsvRow = { index: number; data: Record<string, string> };

const column = z.string().trim().min(1).max(200);
const aggregationFns = ["sum", "avg", "min", "max", "count", "count_distinct"] as const;
const aggregation = z.object({ column, fn: z.enum(aggregationFns) });
const filter = z.object({
  column,
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains"]),
  value: z.union([z.string().max(500), z.number()]),
});
const filters = z.array(filter).max(5).default([]).describe("Optional row filters, combined with AND.");
const documentId = z.guid().describe("ID of an indexed CSV document in this workspace.");

export const analyzeCsvInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("summary"), document_id: documentId }),
  z.object({ operation: z.literal("missing_values"), document_id: documentId }),
  z.object({ operation: z.literal("aggregation"), document_id: documentId, aggregations: z.array(aggregation).min(1).max(8), filters }),
  z.object({
    operation: z.literal("group_by"), document_id: documentId, group_by: column,
    aggregations: z.array(aggregation).min(1).max(5), filters,
    limit: z.number().int().min(1).max(100).default(25),
  }),
  z.object({
    operation: z.literal("trend"), document_id: documentId,
    period_column: column, value_column: column,
    period: z.enum(["as_is", "month", "quarter", "year"]).default("as_is"),
    fn: z.enum(["sum", "avg"]).default("sum"),
    group_by: column.optional(), filters,
  }),
  z.object({
    operation: z.literal("top_n"), document_id: documentId, column,
    n: z.number().int().min(1).max(50).default(10),
    direction: z.enum(["desc", "asc"]).default("desc"),
    include_columns: z.array(column).max(10).optional(), filters,
  }),
]);
export type AnalyzeCsvInput = z.infer<typeof analyzeCsvInputSchema>;
export type CsvOperationInput = AnalyzeCsvInput extends infer T ? T extends unknown ? Omit<T, "document_id"> : never : never;

export type CsvAnalysisResult = {
  rows_total: number;
  rows_used: number;
  row_start: number | null;
  row_end: number | null;
  columns: string[];
  result: unknown;
  notes: string[];
};

const MISSING = new Set(["", "na", "n/a", "null", "nan", "none", "-"]);
export const isMissing = (value: string | undefined) => value === undefined || MISSING.has(value.trim().toLowerCase());

/** Parses "1,234.50", "$1200", "12%", "(300)" (negative). Returns null for non-numeric values. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || isMissing(raw)) return null;
  let text = raw.trim().replace(/[\s$€£¥]/g, "").replace(/%$/, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function parseDate(raw: string): Date | null {
  const text = raw.trim();
  if (!/^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(text) && !/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return null;
  const date = new Date(text.length === 7 ? `${text}-01` : text.replace(/\//g, "-"));
  return Number.isNaN(date.getTime()) ? null : date;
}

const round = (value: number) => Number(value.toPrecision(12));

function periodKey(raw: string, period: "as_is" | "month" | "quarter" | "year"): string | null {
  if (period === "as_is") return raw.trim();
  const date = parseDate(raw);
  if (!date) return null;
  const year = date.getUTCFullYear();
  if (period === "year") return String(year);
  if (period === "quarter") return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function compareKeys(a: string, b: string) {
  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(b, "en", { numeric: true });
}

function aggregate(rows: CsvRow[], spec: { column: string; fn: (typeof aggregationFns)[number] }) {
  const raw = rows.map((row) => row.data[spec.column]);
  if (spec.fn === "count") return raw.filter((value) => !isMissing(value)).length;
  if (spec.fn === "count_distinct") return new Set(raw.filter((value) => !isMissing(value)).map((value) => value!.trim())).size;
  const numbers = raw.map(parseNumber).filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;
  switch (spec.fn) {
    case "sum": return round(numbers.reduce((total, value) => total + value, 0));
    case "avg": return round(numbers.reduce((total, value) => total + value, 0) / numbers.length);
    case "min": return Math.min(...numbers);
    case "max": return Math.max(...numbers);
  }
}

const aggregationKey = (spec: { column: string; fn: string }) => `${spec.fn}(${spec.column})`;

function applyFilters(rows: CsvRow[], list: Array<z.infer<typeof filter>>) {
  return rows.filter((row) => list.every(({ column: name, op, value }) => {
    const cell = row.data[name];
    if (op === "contains") return (cell ?? "").toLowerCase().includes(String(value).toLowerCase());
    const numericCell = parseNumber(cell);
    const numericValue = typeof value === "number" ? value : parseNumber(value);
    if (numericCell !== null && numericValue !== null) {
      switch (op) {
        case "eq": return numericCell === numericValue;
        case "neq": return numericCell !== numericValue;
        case "gt": return numericCell > numericValue;
        case "gte": return numericCell >= numericValue;
        case "lt": return numericCell < numericValue;
        case "lte": return numericCell <= numericValue;
      }
    }
    const text = (cell ?? "").trim().toLowerCase();
    const target = String(value).trim().toLowerCase();
    switch (op) {
      case "eq": return text === target;
      case "neq": return text !== target;
      default: return false; // ordering comparisons need numbers
    }
  }));
}

function rowRange(rows: CsvRow[]) {
  if (rows.length === 0) return { row_start: null, row_end: null };
  let start = rows[0]!.index;
  let end = start;
  for (const row of rows) {
    start = Math.min(start, row.index);
    end = Math.max(end, row.index);
  }
  return { row_start: start, row_end: end };
}

function columnType(values: string[]) {
  const present = values.filter((value) => !isMissing(value));
  if (present.length === 0) return "empty";
  if (present.every((value) => parseNumber(value) !== null)) return "numeric";
  if (present.every((value) => parseDate(value) !== null)) return "date";
  return "text";
}

export function analyzeCsv(rows: CsvRow[], input: CsvOperationInput): CsvAnalysisResult {
  const columns = Object.keys(rows[0]?.data ?? {});
  const referenced = new Set<string>();
  const requireColumn = (name: string) => {
    if (!columns.includes(name)) {
      throw new CsvAnalysisError(`Unknown column "${name}". Available columns: ${columns.slice(0, 50).join(", ")}.`);
    }
    referenced.add(name);
  };
  const notes: string[] = [];
  const finish = (used: CsvRow[], result: unknown): CsvAnalysisResult => ({
    rows_total: rows.length, rows_used: used.length, ...rowRange(used),
    columns: referenced.size ? [...referenced] : columns, result, notes,
  });
  if (rows.length === 0) throw new CsvAnalysisError("The dataset has no rows.");

  if ("filters" in input) for (const item of input.filters) requireColumn(item.column);
  const filtered = "filters" in input ? applyFilters(rows, input.filters) : rows;
  if ("filters" in input && input.filters.length) notes.push(`${filtered.length} of ${rows.length} rows matched the filters.`);

  switch (input.operation) {
    case "summary": {
      const summary = columns.map((name) => {
        const values = rows.map((row) => row.data[name] ?? "");
        const type = columnType(values);
        const present = values.filter((value) => !isMissing(value));
        const base = { name, type, non_empty: present.length, missing: values.length - present.length, distinct: new Set(present).size };
        if (type === "numeric") {
          const numbers = present.map((value) => parseNumber(value)!);
          return { ...base, min: Math.min(...numbers), max: Math.max(...numbers), mean: round(numbers.reduce((a, b) => a + b, 0) / numbers.length), sum: round(numbers.reduce((a, b) => a + b, 0)) };
        }
        return { ...base, sample_values: [...new Set(present)].slice(0, 5).map((value) => value.slice(0, 80)) };
      });
      return finish(rows, { row_count: rows.length, column_count: columns.length, columns: summary });
    }
    case "missing_values": {
      const perColumn = columns.map((name) => {
        const missing = rows.filter((row) => isMissing(row.data[name])).length;
        return { column: name, missing, missing_pct: round((missing / rows.length) * 100) };
      });
      const incomplete = rows.filter((row) => columns.some((name) => isMissing(row.data[name])));
      return finish(rows, { rows_with_missing_values: incomplete.length, columns: perColumn, example_rows: incomplete.slice(0, 10).map((row) => row.index) });
    }
    case "aggregation": {
      input.aggregations.forEach((spec) => requireColumn(spec.column));
      return finish(filtered, Object.fromEntries(input.aggregations.map((spec) => [aggregationKey(spec), aggregate(filtered, spec)])));
    }
    case "group_by": {
      requireColumn(input.group_by);
      input.aggregations.forEach((spec) => requireColumn(spec.column));
      const groups = new Map<string, CsvRow[]>();
      for (const row of filtered) {
        const key = isMissing(row.data[input.group_by]) ? "(missing)" : row.data[input.group_by]!.trim();
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
      }
      const sortKey = aggregationKey(input.aggregations[0]!);
      const results = [...groups.entries()].map(([key, groupRows]) => ({
        key,
        rows: groupRows.length,
        range: rowRange(groupRows),
        values: Object.fromEntries(input.aggregations.map((spec) => [aggregationKey(spec), aggregate(groupRows, spec)])) as Record<string, number | null>,
      })).sort((a, b) => (b.values[sortKey] ?? -Infinity) - (a.values[sortKey] ?? -Infinity));
      if (results.length > input.limit) notes.push(`Showing the top ${input.limit} of ${results.length} groups by ${sortKey}.`);
      return finish(filtered, {
        group_count: results.length,
        sorted_by: sortKey,
        groups: results.slice(0, input.limit).map((group) => ({ [input.group_by]: group.key, rows: group.rows, ...group.range, ...group.values })),
      });
    }
    case "trend": {
      requireColumn(input.period_column);
      requireColumn(input.value_column);
      if (input.group_by) requireColumn(input.group_by);
      let skipped = 0;
      const buckets = new Map<string, Map<string, CsvRow[]>>();
      for (const row of filtered) {
        const key = periodKey(row.data[input.period_column] ?? "", input.period);
        if (!key || isMissing(row.data[input.period_column])) {
          skipped += 1;
          continue;
        }
        const group = input.group_by ? (row.data[input.group_by]?.trim() || "(missing)") : "all";
        const series = buckets.get(group) ?? new Map<string, CsvRow[]>();
        const bucket = series.get(key);
        if (bucket) bucket.push(row);
        else series.set(key, [row]);
        buckets.set(group, series);
      }
      if (skipped) notes.push(`${skipped} rows were skipped because the period value was missing or not a recognizable date.`);
      const used: CsvRow[] = [];
      const series = [...buckets.entries()].slice(0, 10).map(([group, periods]) => {
        const points = [...periods.entries()].sort(([a], [b]) => compareKeys(a, b)).map(([period, periodRows]) => {
          used.push(...periodRows);
          return { period, value: aggregate(periodRows, { column: input.value_column, fn: input.fn }), rows: periodRows.length };
        });
        const values = points.map((point) => point.value).filter((value): value is number => value !== null);
        const first = values[0];
        const last = values.at(-1);
        const changes = points.slice(1).map((point, index) => ({
          from: points[index]!.period, to: point.period,
          change: point.value !== null && points[index]!.value !== null ? round(point.value - points[index]!.value!) : null,
        })).filter((item) => item.change !== null);
        return {
          group, points,
          change_abs: first !== undefined && last !== undefined ? round(last - first) : null,
          change_pct: first !== undefined && last !== undefined && first !== 0 ? round(((last - first) / Math.abs(first)) * 100) : null,
          largest_increase: changes.reduce<(typeof changes)[number] | null>((best, item) => (!best || item.change! > best.change! ? item : best), null),
          largest_decrease: changes.reduce<(typeof changes)[number] | null>((best, item) => (!best || item.change! < best.change! ? item : best), null),
        };
      });
      if (buckets.size > 10) notes.push(`Showing 10 of ${buckets.size} groups.`);
      return finish(used, { value: `${input.fn}(${input.value_column})`, period: input.period, series });
    }
    case "top_n": {
      requireColumn(input.column);
      input.include_columns?.forEach(requireColumn);
      const ranked = filtered
        .map((row) => ({ row, value: parseNumber(row.data[input.column]) }))
        .filter((item): item is { row: CsvRow; value: number } => item.value !== null)
        .sort((a, b) => (input.direction === "desc" ? b.value - a.value : a.value - b.value))
        .slice(0, input.n);
      const shown = input.include_columns?.length ? [...new Set([input.column, ...input.include_columns])] : columns.slice(0, 10);
      return finish(ranked.map((item) => item.row), {
        column: input.column, direction: input.direction,
        rows: ranked.map(({ row }) => ({ row_index: row.index, ...Object.fromEntries(shown.map((name) => [name, (row.data[name] ?? "").slice(0, 200)])) })),
      });
    }
  }
}
