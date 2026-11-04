"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { sqlChartSpecSchema, type SqlChartSpec } from "@/lib/sql-chart";
import { colors } from "./hkex-chart";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";

const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value);

export function SqlChart({ spec }: { spec: SqlChartSpec }) {
  const parsed = sqlChartSpecSchema.safeParse(spec);
  if (!parsed.success) return <p role="alert" className="my-3 text-sm text-rose-300">This chart is invalid and could not be displayed. The table above has the exact values.</p>;
  const props = parsed.data;
  const series = [...new Set(props.points.map((point) => point.series))];
  const labels = [...new Set(props.points.map((point) => point.label))];
  const data = labels.map((label) => {
    const row: Record<string, string | number | null> = { label };
    series.forEach((name, index) => {
      row[`s${index}`] = props.points.find((item) => item.label === label && item.series === name)?.value ?? null;
    });
    return row;
  });
  const config: ChartConfig = {};
  series.forEach((name, index) => { config[`s${index}`] = { label: name, theme: colors[index % colors.length] }; });
  const horizontal = props.type === "horizontal-bar";
  const Chart = props.type === "area" ? AreaChart : props.type === "line" ? LineChart : BarChart;
  return (
    <figure data-sql-chart className="my-4 min-w-0 border border-slate-700 p-3 md:p-4" aria-label={`${props.title} ${props.type} chart`}>
      <figcaption>
        <h3 className="text-sm font-semibold text-slate-200">{props.title}</h3>
        <p className="mt-1 text-xs text-slate-400">From &ldquo;{props.resultTitle}&rdquo; · {props.labelColumn} by {props.valueLabel}</p>
      </figcaption>
      <ChartContainer config={config} className="mt-3 min-w-0 w-full aspect-auto" style={{ height: horizontal ? Math.min(640, Math.max(288, labels.length * 26 + 40)) : 288 }} aria-hidden="true">
        <Chart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 12, right: 8, left: 0, bottom: 12 }}>
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} />
          <XAxis dataKey={horizontal ? undefined : "label"} type={horizontal ? "number" : "category"} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={horizontal ? compact : undefined} />
          <YAxis dataKey={horizontal ? "label" : undefined} type={horizontal ? "category" : "number"} tickLine={false} axisLine={false} width={horizontal ? 96 : 64} tickFormatter={horizontal ? (value: string) => value.length > 14 ? `${value.slice(0, 13)}…` : value : compact} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 && <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />}
          {series.map((name, index) => {
            const key = `s${index}`;
            const color = `var(--color-${key})`;
            if (props.type === "area") return <Area key={name} dataKey={key} fill={color} fillOpacity={0.2} stroke={color} type="linear" connectNulls={false} isAnimationActive={false} />;
            if (props.type === "line") return <Line key={name} dataKey={key} stroke={color} strokeWidth={2} type="linear" dot={labels.length <= 20} connectNulls={false} isAnimationActive={false} />;
            return <Bar key={name} dataKey={key} fill={color} radius={3} maxBarSize={40} isAnimationActive={false} />;
          })}
        </Chart>
      </ChartContainer>
      <p className="mt-2 text-xs text-slate-500">Built from the returned rows. See the table for exact values. Missing values do not mean zero.</p>
      {props.truncated && <p role="status" className="mt-2 text-xs text-amber-400">Some matching rows were not returned, so the chart may be incomplete.</p>}
      <details className="mt-3 text-xs text-slate-300">
        <summary className="cursor-pointer py-2">View data ({props.points.length} values)</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{props.title}, exact values</caption>
            <thead><tr><th className="p-2">{props.labelColumn}</th><th className="p-2">Series</th><th className="p-2">{props.valueLabel}</th></tr></thead>
            <tbody>{props.points.map((point, index) => <tr key={index} className="border-t border-slate-700"><td className="p-2">{point.label}</td><td className="p-2">{point.series}</td><td className="p-2 font-mono">{point.value ?? "Unavailable"}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
