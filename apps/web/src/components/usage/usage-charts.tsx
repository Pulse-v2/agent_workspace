"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsageSummary } from "@/features/usage/queries";
import { useThemeColors, type ThemeColors } from "@/hooks/use-theme-colors";
import { formatCompact, formatCost } from "@/lib/format";

const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const axis = (colors: ThemeColors) => ({ tickLine: false, axisLine: false, tick: { fontSize: 11, fill: colors["muted-foreground"] } }) as const;
const tooltipStyle = (colors: ThemeColors) => ({ background: colors.popover, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12, color: colors["popover-foreground"] });

export function TokensChart({ daily }: { daily: UsageSummary["daily"] }) {
  const colors = useThemeColors();
  const data = daily.map((day) => ({ ...day, label: label(day.day) }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis dataKey="label" {...axis(colors)} interval="preserveStartEnd" />
          <YAxis {...axis(colors)} tickFormatter={(value: number) => formatCompact(value)} />
          <Tooltip contentStyle={tooltipStyle(colors)} cursor={{ fill: colors.muted }} formatter={(value) => formatCompact(Number(value))} />
          <Bar dataKey="input_tokens" name="Input tokens" stackId="tokens" fill={colors.info} maxBarSize={24} isAnimationActive={false} />
          <Bar dataKey="output_tokens" name="Output tokens" stackId="tokens" fill={colors.success} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostChart({ daily }: { daily: UsageSummary["daily"] }) {
  const colors = useThemeColors();
  const data = daily.map((day) => ({ ...day, label: label(day.day) }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={colors.border} />
          <XAxis dataKey="label" {...axis(colors)} interval="preserveStartEnd" />
          <YAxis {...axis(colors)} tickFormatter={(value: number) => formatCost(value)} />
          <Tooltip contentStyle={tooltipStyle(colors)} formatter={(value) => formatCost(Number(value))} />
          <Line type="monotone" dataKey="estimated_cost_usd" name="Estimated cost" stroke={colors.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
