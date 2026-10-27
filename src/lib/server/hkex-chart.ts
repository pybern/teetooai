import { z } from "zod";
import { HKEX_CHART_OPTIONS, hkexChartSpecSchema, type HkexChartSpec, type HkexChartType } from "@/lib/hkex-chart";
import { ConnectionError } from "./connections";
import type { DatabaseEvidence, HkexQuery } from "./hkex-database";

export function getHkexChartOptions(evidence: DatabaseEvidence, query: HkexQuery) {
  const ranking = query.mode === "ranking";
  const seriesCount = query.mode === "stock-trend" ? new Set(evidence.rows.map((row) => row.stock_code)).size : 1;
  const values = evidence.rows.map((row) => row[query.metric]);
  const hasNulls = values.some((value) => value === null || value === undefined);
  const choices = HKEX_CHART_OPTIONS.filter(({ type }) => {
    if (!evidence.rows.length) return false;
    if (type === "bar" || type === "horizontal-bar") return ranking;
    if (type === "line") return !ranking;
    if (type === "area") return !ranking && seriesCount === 1 && new Set(evidence.rows.map((row) => row.trading_date)).size >= 2;
    return ranking && query.metric !== "short_turnover_percent" && !evidence.truncated && !hasNulls &&
      evidence.rows.length >= 2 && evidence.rows.length <= 8 &&
      values.every((value) => typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) &&
      values.filter((value) => Number(value) > 0).length >= 2;
  });
  return {
    schema: {
      category: ranking ? "stock" : "date", value: "decimal-string", metric: query.metric,
      currency: query.currency, seriesCount, pointCount: evidence.rows.length, hasNulls, truncated: evidence.truncated,
    },
    choices,
    recommendedComponent: !evidence.rows.length ? null : ranking
      ? evidence.rows.length > 6 || evidence.rows.some((row) => String(row.stock_name ?? "").length > 14) ? "HKEXHorizontalBarChart" : "HKEXBarChart"
      : "HKEXLineChart",
  };
}

export function buildHkexChart(evidence: DatabaseEvidence, query: HkexQuery, type: HkexChartType): HkexChartSpec {
  if (!evidence.rows.length) throw new ConnectionError("No retrieved rows are available to chart. Narrow or change the query.");
  const options = getHkexChartOptions(evidence, query);
  const choice = options.choices.find((item) => item.type === type);
  if (!choice) {
    throw new ConnectionError(`This chart is incompatible with the retrieved data schema. Choose from: ${options.choices.map((item) => item.component).join(", ")}.`);
  }
  const stockSeries = new Map<string, string>();
  const points = evidence.rows.map((row) => {
    if (row.trading_currency !== query.currency) throw new ConnectionError("Chart evidence must use the query's single currency.");
    if (!z.iso.date().safeParse(row.first_date).success || !z.iso.date().safeParse(row.last_date).success ||
      (query.mode !== "ranking" && !z.iso.date().safeParse(row.trading_date).success)) {
      throw new ConnectionError("Chart evidence must include valid stored trading dates.");
    }
    const code = row.stock_code;
    if (query.mode !== "market-trend" && (typeof code !== "string" || !/^\d{5}$/.test(code))) {
      throw new ConnectionError("Chart evidence must preserve five-digit stock codes.");
    }
    const name = typeof row.stock_name === "string" ? ` ${row.stock_name.slice(0, 120)}` : "";
    if (typeof code === "string" && !stockSeries.has(code)) stockSeries.set(code, `${code}${name}`);
    return {
      label: query.mode === "ranking" ? `${code}${name}` : row.trading_date,
      series: query.mode === "stock-trend" && typeof code === "string" ? stockSeries.get(code) : "Market",
      value: row[query.metric],
    };
  });
  const firstDates = evidence.rows.map((row) => row.first_date).filter((value): value is string => typeof value === "string").sort();
  const lastDates = evidence.rows.map((row) => row.last_date).filter((value): value is string => typeof value === "string").sort();
  const spec = hkexChartSpecSchema.safeParse({
    root: "chart",
    elements: {
      chart: {
        type: choice.component, children: [],
        props: {
          type, metric: query.metric, currency: query.currency,
          from: firstDates[0], to: lastDates.at(-1), truncated: evidence.truncated, points,
          sources: [...new Set(evidence.rows.map((row) => row.source_url))],
        },
      },
    },
  });
  if (!spec.success) throw new ConnectionError("Retrieved evidence cannot form a valid chart. Check dates, numeric values and HKEX source links; no chart was generated.", 502);
  const keys = new Set<string>();
  for (const point of spec.data.elements.chart.props.points) {
    const key = JSON.stringify([point.label, point.series]);
    if (keys.has(key)) throw new ConnectionError("Chart evidence has duplicate categories. Query one unambiguous series per stock and date.", 502);
    keys.add(key);
  }
  if (type === "line" || type === "area") spec.data.elements.chart.props.points.sort((a, b) => a.label.localeCompare(b.label) || a.series.localeCompare(b.series));
  return spec.data;
}
