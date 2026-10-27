import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const HKEX_CHART_METRICS = {
  short_selling_value: "Short-selling value",
  short_selling_shares: "Short-selling shares",
  short_turnover_percent: "Short turnover ratio",
} as const;

export const HKEX_CHART_OPTIONS = [
  { component: "HKEXBarChart", type: "bar", description: "Vertical bars for a small categorical stock ranking." },
  { component: "HKEXHorizontalBarChart", type: "horizontal-bar", description: "Horizontal bars for many ranked stocks or long stock names." },
  { component: "HKEXLineChart", type: "line", description: "A chronological trend, especially comparisons across multiple stock series." },
  { component: "HKEXAreaChart", type: "area", description: "Magnitude over time for one series with at least two dates; never stacked." },
  { component: "HKEXDonutChart", type: "donut", description: "Composition of 2-8 fully returned stocks, only additive values/shares with no nulls and at least two positive values. Never ratios or partial results; not a claim of whole-market share." },
] as const;

export type HkexChartComponent = typeof HKEX_CHART_OPTIONS[number]["component"];
export type HkexChartType = typeof HKEX_CHART_OPTIONS[number]["type"];

export const hkexChartPropsSchema = z.object({
  type: z.enum(["bar", "horizontal-bar", "line", "area", "donut"]),
  metric: z.enum(["short_selling_value", "short_selling_shares", "short_turnover_percent"]),
  currency: z.enum(["HKD", "CNY", "USD"]),
  from: z.iso.date(),
  to: z.iso.date(),
  truncated: z.boolean(),
  points: z.array(z.object({
    label: z.string().min(1).max(140),
    series: z.string().min(1).max(140),
    value: z.string().max(80).regex(/^\d+(?:\.\d+)?$/).refine((value) => Number.isFinite(Number(value))).nullable(),
  }).strict()).min(1).max(100),
  sources: z.array(z.url().max(512).refine((value) => {
    const url = new URL(value);
    return url.origin === "https://www.hkex.com.hk" && !url.username && !url.password;
  })).min(1).max(100),
}).strict();

export const hkexChartCatalog = defineCatalog(schema, {
  components: {
    HKEXBarChart: { props: hkexChartPropsSchema.extend({ type: z.literal("bar") }), description: HKEX_CHART_OPTIONS[0].description },
    HKEXHorizontalBarChart: { props: hkexChartPropsSchema.extend({ type: z.literal("horizontal-bar") }), description: HKEX_CHART_OPTIONS[1].description },
    HKEXLineChart: { props: hkexChartPropsSchema.extend({ type: z.literal("line") }), description: HKEX_CHART_OPTIONS[2].description },
    HKEXAreaChart: { props: hkexChartPropsSchema.extend({ type: z.literal("area") }), description: HKEX_CHART_OPTIONS[3].description },
    HKEXDonutChart: { props: hkexChartPropsSchema.extend({ type: z.literal("donut") }), description: HKEX_CHART_OPTIONS[4].description },
  },
  actions: {},
});

// Accept only a single inert chart: no generated actions, bindings or arbitrary component trees.
export const hkexChartSpecSchema = z.object({
  root: z.literal("chart"),
  elements: z.object({
    chart: z.discriminatedUnion("type", [
      z.object({ type: z.literal("HKEXBarChart"), props: hkexChartCatalog.data.components.HKEXBarChart.props, children: z.tuple([]) }).strict(),
      z.object({ type: z.literal("HKEXHorizontalBarChart"), props: hkexChartCatalog.data.components.HKEXHorizontalBarChart.props, children: z.tuple([]) }).strict(),
      z.object({ type: z.literal("HKEXLineChart"), props: hkexChartCatalog.data.components.HKEXLineChart.props, children: z.tuple([]) }).strict(),
      z.object({ type: z.literal("HKEXAreaChart"), props: hkexChartCatalog.data.components.HKEXAreaChart.props, children: z.tuple([]) }).strict(),
      z.object({ type: z.literal("HKEXDonutChart"), props: hkexChartCatalog.data.components.HKEXDonutChart.props, children: z.tuple([]) }).strict(),
    ]),
  }).strict(),
}).strict();

export type HkexChartProps = z.infer<typeof hkexChartPropsSchema>;
export type HkexChartSpec = z.infer<typeof hkexChartSpecSchema>;
