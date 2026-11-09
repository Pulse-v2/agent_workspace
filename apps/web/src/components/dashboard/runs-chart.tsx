"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyRuns } from "@/features/dashboard/queries";
import { useThemeColors } from "@/hooks/use-theme-colors";

export function RunsChart({ data }: { data: DailyRuns[] }) {
  const colors = useThemeColors();
  const series = [
    { key: "completed", label: "Completed", color: colors.success },
    { key: "failed", label: "Failed", color: colors.destructive },
    { key: "other", label: "Active / other", color: colors.info },
  ] as const;
  const empty = data.every((day) => day.completed + day.failed + day.other === 0);
  const tick = { fontSize: 11, fill: colors["muted-foreground"] };
  return (
    <div className="relative h-64 w-full">
      {empty && <p className="absolute inset-0 z-10 grid place-items-center text-sm text-muted-foreground">No runs in the last 14 days.</p>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={tick} />
          <Tooltip
            cursor={{ fill: colors.muted }}
            contentStyle={{ background: colors.popover, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors["popover-foreground"] }}
          />
          {series.map((item) => <Bar key={item.key} dataKey={item.key} name={item.label} stackId="runs" fill={item.color} radius={item.key === "other" ? [3, 3, 0, 0] : 0} maxBarSize={28} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((item) => <span key={item.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}
      </div>
    </div>
  );
}
