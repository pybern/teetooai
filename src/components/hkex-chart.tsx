"use client";

import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "recharts";
import { HKEX_CHART_METRICS, hkexChartCatalog, hkexChartSpecSchema, type HkexChartProps, type HkexChartSpec } from "@/lib/hkex-chart";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";

export const colors = [
  { light: "#2563eb", dark: "#60a5fa" },
  { light: "#7c3aed", dark: "#a78bfa" },
  { light: "#0d9488", dark: "#2dd4bf" },
  { light: "#b45309", dark: "#fbbf24" },
  { light: "#be185d", dark: "#f472b6" },
  { light: "#4f46e5", dark: "#818cf8" },
  { light: "#4d7c0f", dark: "#a3e635" },
  { light: "#c2410c", dark: "#fb923c" },
];

function ResearchChart({ props }: { props: HkexChartProps }) {
  const metric = HKEX_CHART_METRICS[props.metric];
  const unit = props.metric === "short_selling_value" ? props.currency : props.metric === "short_turnover_percent" ? "%" : "shares";
  const series = [...new Set(props.points.map((point) => point.series))];
  const labels = [...new Set(props.points.map((point) => point.label))];
  const data = labels.map((label) => {
    const row: Record<string, string | number | null> = { label };
    series.forEach((name, index) => {
      const point = props.points.find((item) => item.label === label && item.series === name);
      row[`s${index}`] = point?.value === null || point?.value === undefined ? null : Number(point.value);
    });
    return row;
  });
  const config: ChartConfig = {};
  series.forEach((name, index) => {
    config[`s${index}`] = { label: name === "Market" ? `${metric} (${unit})` : name, theme: colors[index % colors.length] };
  });
  const slices = props.type === "donut" ? props.points.map((point, index) => {
    const category = `category${index}`;
    config[category] = { label: point.label, theme: colors[index % colors.length] };
    return { category, value: point.value === null ? null : Number(point.value), fill: `var(--color-${category})` };
  }) : [];
  const horizontal = props.type === "horizontal-bar";
  const Chart = props.type === "area" ? AreaChart : props.type === "line" ? LineChart : BarChart;
  return (
    <figure className="my-4 min-w-0 border border-slate-700 p-3 md:p-4" aria-label={`${metric} ${props.type} chart`}>
      <figcaption>
        <h3 className="text-sm font-semibold text-slate-200">{metric} ({unit})</h3>
        <p className="mt-1 text-xs text-slate-400">Stored dates: {props.from} to {props.to} · {props.currency}</p>
      </figcaption>
      <ChartContainer config={config} className="mt-3 min-w-0 w-full aspect-auto" style={{ height: horizontal ? Math.min(640, Math.max(288, labels.length * 26 + 40)) : 288 }} aria-hidden="true">
        {props.type === "donut" ? (
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="category" hideLabel />} />
            <Pie data={slices} dataKey="value" nameKey="category" innerRadius="50%" outerRadius="80%" isAnimationActive={false}>
              {slices.map((slice) => <Cell key={slice.category} fill={slice.fill} />)}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="category" className="flex-wrap gap-x-3 gap-y-1" />} />
          </PieChart>
        ) : (
          <Chart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 12, right: 8, left: 0, bottom: 12 }}>
            <CartesianGrid vertical={horizontal} horizontal={!horizontal} />
            <XAxis dataKey={horizontal ? undefined : "label"} type={horizontal ? "number" : "category"} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={horizontal ? (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value) : undefined} />
            <YAxis dataKey={horizontal ? "label" : undefined} type={horizontal ? "category" : "number"} tickLine={false} axisLine={false} width={64} tickFormatter={horizontal ? (value: string) => value.slice(0, 5) : (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value)} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />}
            {series.map((name, index) => {
              const key = `s${index}`;
              const color = `var(--color-${key})`;
              if (props.type === "area") return <Area key={name} dataKey={key} fill={color} fillOpacity={0.2} stroke={color} type="linear" connectNulls={false} isAnimationActive={false} />;
              if (props.type === "line") return <Line key={name} dataKey={key} stroke={color} strokeWidth={2} type="linear" dot={props.points.length <= 20} connectNulls={false} isAnimationActive={false} />;
              return <Bar key={name} dataKey={key} fill={color} radius={3} maxBarSize={40} isAnimationActive={false} />;
            })}
          </Chart>
        )}
      </ChartContainer>
      <p className="mt-2 text-xs text-slate-500">See the table for exact values. Missing values do not mean zero. Some trading days may not be included.</p>
      {props.metric === "short_turnover_percent" && <p className="mt-2 text-xs text-slate-400">Short turnover ratio is not short interest. The ratio is unavailable when total turnover is missing or zero.</p>}
      {props.type === "donut" && <p className="mt-2 text-xs text-slate-400">Shares cover only the stocks shown, not the whole market.</p>}
      {props.truncated && <p role="status" className="mt-2 text-xs text-amber-400">Some matching data is not shown. Try a narrower date range or fewer stocks for a complete comparison.</p>}
      <details className="mt-3 text-xs text-slate-300">
        <summary className="cursor-pointer py-2">View data ({props.points.length} results)</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{metric}, exact values in {unit}</caption>
            <thead><tr><th className="p-2">Stock / date</th><th className="p-2">Series</th><th className="p-2">{unit}</th></tr></thead>
            <tbody>{props.points.map((point, index) => <tr key={index} className="border-t border-slate-700"><td className="p-2">{point.label}</td><td className="p-2">{point.series}</td><td className="p-2 font-mono">{point.value ?? "Unavailable"}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <details className="mt-2 text-xs text-slate-400">
        <summary className="cursor-pointer py-2">Representative HKEX sources ({props.sources.length})</summary>
        <ul className="space-y-2">{props.sources.map((source, index) => <li key={source}><a href={source} target="_blank" rel="noopener noreferrer" className="break-all text-sky-300 underline">HKEX source {index + 1}</a></li>)}</ul>
      </details>
    </figure>
  );
}

const { registry } = defineRegistry(hkexChartCatalog, {
  components: {
    HKEXBarChart: ResearchChart,
    HKEXHorizontalBarChart: ResearchChart,
    HKEXLineChart: ResearchChart,
    HKEXAreaChart: ResearchChart,
    HKEXDonutChart: ResearchChart,
  },
});

export function HkexChart({ spec }: { spec: HkexChartSpec }) {
  const parsed = hkexChartSpecSchema.safeParse(spec);
  if (!parsed.success) return <p role="alert" className="my-3 text-sm text-rose-300">The research chart is invalid and could not be displayed. Retry the chart query.</p>;
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={parsed.data} registry={registry} />
    </JSONUIProvider>
  );
}
