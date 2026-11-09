/**
 * Human-readable summaries of analyze_csv results for the model and for
 * reports. Values are formatted, not interpreted: no conclusions are added.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const show = (value: unknown) => (typeof value === "number" ? numberFormat.format(value) : value === null || value === undefined ? "n/a" : String(value));
const MAX_ITEMS = 12;

export function describeCsvResult(operation: string, result: unknown): string {
  if (!isRecord(result)) return JSON.stringify(result ?? null).slice(0, 600);
  switch (operation) {
    case "summary": {
      const columns = Array.isArray(result.columns) ? result.columns.filter(isRecord) : [];
      const parts = columns.slice(0, MAX_ITEMS).map((column) => column.type === "numeric"
        ? `${show(column.name)} (numeric: min ${show(column.min)}, max ${show(column.max)}, mean ${show(column.mean)}, sum ${show(column.sum)}${column.missing ? `, ${show(column.missing)} missing` : ""})`
        : `${show(column.name)} (${show(column.type)}, ${show(column.distinct)} distinct${Array.isArray(column.sample_values) && column.sample_values.length ? `: ${column.sample_values.slice(0, 3).join(", ")}` : ""})`);
      return `${show(result.row_count)} rows, ${show(result.column_count)} columns: ${parts.join("; ")}.`;
    }
    case "missing_values": {
      const columns = Array.isArray(result.columns) ? result.columns.filter(isRecord).filter((column) => Number(column.missing) > 0) : [];
      return `${show(result.rows_with_missing_values)} rows have missing values${columns.length ? ` (${columns.slice(0, MAX_ITEMS).map((column) => `${show(column.column)}: ${show(column.missing)}`).join(", ")})` : ""}.`;
    }
    case "aggregation":
      return Object.entries(result).map(([key, value]) => `${key} = ${show(value)}`).join("; ") + ".";
    case "group_by": {
      const groups = Array.isArray(result.groups) ? result.groups.filter(isRecord) : [];
      const lines = groups.slice(0, MAX_ITEMS).map((group) => Object.entries(group)
        .filter(([key]) => !["row_start", "row_end"].includes(key))
        .map(([key, value]) => `${key} ${show(value)}`).join(", "));
      return `${show(result.group_count)} groups sorted by ${show(result.sorted_by)}: ${lines.join(" | ")}.`;
    }
    case "trend": {
      const series = Array.isArray(result.series) ? result.series.filter(isRecord) : [];
      const lines = series.slice(0, MAX_ITEMS).map((item) => {
        const points = Array.isArray(item.points) ? item.points.filter(isRecord) : [];
        const values = points.map((point) => `${show(point.period)}: ${show(point.value)}`).join(", ");
        return `${show(item.group)} — ${values}; change ${show(item.change_abs)} (${show(item.change_pct)}%)`;
      });
      return `${show(result.value)} by ${show(result.period)}: ${lines.join(" | ")}.`;
    }
    case "top_n": {
      const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : [];
      return `Top rows by ${show(result.column)} (${show(result.direction)}): ${rows.slice(0, MAX_ITEMS).map((row) => `row ${show(row.row_index)}: ${Object.entries(row).filter(([key]) => key !== "row_index").map(([key, value]) => `${key} ${show(value)}`).join(", ")}`).join(" | ")}.`;
    }
    default:
      return JSON.stringify(result).slice(0, 600);
  }
}
