import { z } from "zod";

export const SQL_CHART_TYPES = ["bar", "horizontal-bar", "line", "area"] as const;
export type SqlChartType = typeof SQL_CHART_TYPES[number];
export const SQL_CHART_MAX_POINTS = 100;
export const SQL_CHART_MAX_SERIES = 8;

/** A chart built by the server from catalogue SQL rows; every value comes from the returned rows. */
export const sqlChartSpecSchema = z.object({
  type: z.enum(SQL_CHART_TYPES),
  title: z.string().min(1).max(160),
  resultTitle: z.string().min(1).max(160),
  labelColumn: z.string().min(1).max(64),
  valueLabel: z.string().min(1).max(64),
  tables: z.array(z.string().min(1).max(200)).max(10),
  truncated: z.boolean(),
  points: z.array(z.object({
    label: z.string().min(1).max(140),
    series: z.string().min(1).max(140),
    value: z.number().finite().nullable(),
  }).strict()).min(2).max(SQL_CHART_MAX_POINTS),
}).strict();

export type SqlChartSpec = z.infer<typeof sqlChartSpecSchema>;
