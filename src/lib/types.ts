export type NumberFormat = {
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

export type MetricDef = {
  key: string;
  label: string;
  short?: string;
  format: NumberFormat;
  aliases: string[];
  higherIsBetter?: boolean;
  description?: string;
  /** Prices and index levels: comparisons across entities should be rebased to 100. */
  rebaseOnCompare?: boolean;
  /** Values can be added across entities (totals, shares of total). */
  summable?: boolean;
  /** Natural upper bound (e.g. 100% share, total car market); forecasts use an S-curve below it. */
  ceiling?: number;
};

export type Row = {
  entity?: string;
  /** Decimal year; monthly rows use year + (month - 1) / 12. */
  year?: number;
  label?: string;
  [key: string]: string | number | undefined;
};

export type DatasetKind = "timeseries" | "cross-section" | "panel";

export type EntityDef = {
  name: string;
  aliases?: string[];
};

export type Dataset = {
  id: string;
  name: string;
  description: string;
  kind: DatasetKind;
  grain?: "year" | "month";
  entityLabel?: string;
  entities?: EntityDef[];
  groupAttrs?: { key: string; label: string; aliases: string[] }[];
  metrics: MetricDef[];
  defaultMetric: string;
  rows: Row[];
  keywords: string[];
  source: { name: string; url: string; note?: string };
  asOf: string;
};

export type Intent =
  | "trend"
  | "rank"
  | "share"
  | "compare"
  | "correlation"
  | "forecast"
  | "anomaly"
  | "growth"
  | "snapshot";

export type Interpretation = {
  question: string;
  datasetId: string;
  datasetName: string;
  intent: Intent;
  metrics: string[];
  entities: string[];
  groupBy?: string;
  yearFrom?: number;
  yearTo?: number;
  year?: number;
  targetYear?: number;
  topN?: number;
  order: "desc" | "asc";
  confidence: number;
};

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "hbar"
  | "stacked-bar"
  | "donut"
  | "composed"
  | "scatter"
  | "radar"
  | "treemap"
  | "radial";

export type SeriesSpec = {
  key: string;
  label: string;
  color?: string;
  kind?: "line" | "bar" | "area" | "scatter";
  axis?: "left" | "right";
  dashed?: boolean;
  format?: NumberFormat;
};

export type ChartDatum = Record<string, string | number | null | undefined>;

export type ChartSpec = {
  id: string;
  type: ChartType;
  title: string;
  subtitle?: string;
  data: ChartDatum[];
  xKey: string;
  series: SeriesSpec[];
  format?: NumberFormat;
  rightFormat?: NumberFormat;
  highlightKey?: string;
  referenceY?: { value: number; label: string }[];
  referenceX?: { value: string | number; label: string }[];
  band?: { lowKey: string; highKey: string };
  colorByKey?: string;
  span?: "full" | "half";
};

export type Kpi = {
  label: string;
  value: string;
  delta?: string;
  direction?: "up" | "down" | "flat";
  good?: boolean;
  hint?: string;
  spark?: number[];
};

export type InsightKind =
  | "trend"
  | "peak"
  | "low"
  | "comparison"
  | "anomaly"
  | "share"
  | "forecast"
  | "correlation"
  | "concentration"
  | "momentum"
  | "caveat";

export type Insight = {
  kind: InsightKind;
  title: string;
  text: string;
  tone?: "positive" | "negative" | "neutral" | "warning";
};

export type TableSpec = {
  columns: { key: string; label: string; format?: NumberFormat; align?: "left" | "right" }[];
  rows: ChartDatum[];
};

export type InsightReport = {
  id: string;
  createdAt: number;
  question: string;
  useCaseId: string;
  interpretation: Interpretation;
  title: string;
  headline: string;
  kpis: Kpi[];
  charts: ChartSpec[];
  insights: Insight[];
  table: TableSpec;
  sql: string;
  steps: string[];
  followUps: string[];
  source: { name: string; url: string; note?: string };
  asOf: string;
};

export type UseCase = {
  id: string;
  name: string;
  persona: string;
  tagline: string;
  scenario: string;
  icon: "candlestick" | "landmark" | "leaf" | "zap" | "cpu" | "globe";
  accent: string;
  datasetIds: string[];
  questions: { q: string; tag: string }[];
};
