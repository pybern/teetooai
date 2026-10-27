import { describe, expect, it } from "vitest";
import { buildHkexChart, getHkexChartOptions } from "./hkex-chart";
import { hkexChartCatalog, hkexChartSpecSchema } from "@/lib/hkex-chart";
import type { DatabaseEvidence, HkexQuery } from "./hkex-database";

const query: HkexQuery = { mode: "ranking", from: null, to: null, stockCodes: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 10 };
const row = {
  stock_code: "00700", stock_name: "TENCENT", short_selling_value: "9007199254740993.12",
  short_selling_shares: "9007199254740993", short_turnover_percent: null,
  trading_currency: "HKD", first_date: "2026-01-05", last_date: "2026-01-05",
  source_url: "https://www.hkex.com.hk/example",
};
const evidence: DatabaseEvidence = { sql: "SELECT", parameters: [], rows: [row], truncated: false };

describe("grounded json-render chart specification", () => {
  it("builds a catalog-valid ranking with exact decimals, leading zeros, currency, dates and sources", () => {
    const spec = buildHkexChart(evidence, query, "bar");
    expect(hkexChartCatalog.validate(spec).success).toBe(true);
    expect(spec.elements.chart.props).toMatchObject({
      metric: "short_selling_value", currency: "HKD", from: "2026-01-05", to: "2026-01-05",
      points: [{ label: "00700 TENCENT", series: "Market", value: "9007199254740993.12" }],
      sources: ["https://www.hkex.com.hk/example"],
    });
  });
  it("keeps null ratios unavailable, not zero, and preserves truncation", () => {
    const spec = buildHkexChart({ ...evidence, truncated: true }, { ...query, metric: "short_turnover_percent" }, "bar");
    expect(spec.elements.chart.props.points[0].value).toBeNull();
    expect(spec.elements.chart.props.truncated).toBe(true);
  });
  it("sorts stock trends chronologically and keeps each stock as a separate series", () => {
    const spec = buildHkexChart({
      ...evidence, rows: [
        { ...row, trading_date: "2026-01-06", last_date: "2026-01-06" },
        { ...row, stock_code: "00005", stock_name: "HSBC", trading_date: "2026-01-05" },
        { ...row, trading_date: "2026-01-05" },
      ],
    }, { ...query, mode: "stock-trend", stockCodes: ["00700", "00005"] }, "line");
    expect(spec.elements.chart.props.points.map((point) => [point.label, point.series])).toEqual([
      ["2026-01-05", "00005 HSBC"], ["2026-01-05", "00700 TENCENT"], ["2026-01-06", "00700 TENCENT"],
    ]);
    expect(spec.elements.chart.props.to).toBe("2026-01-06");
  });
  it("supports market totals without requiring stock codes", () => {
    const spec = buildHkexChart({ ...evidence, rows: [{ ...row, stock_code: null, stock_name: null, trading_date: "2026-01-05" }] }, { ...query, mode: "market-trend" }, "line");
    expect(spec.elements.chart.props.points[0].series).toBe("Market");
  });
  it("does not split one stock into different series when its stored name changes", () => {
    const spec = buildHkexChart({ ...evidence, rows: [
      { ...row, trading_date: "2026-01-05" },
      { ...row, stock_name: "TENCENT HOLDINGS", trading_date: "2026-01-06", last_date: "2026-01-06" },
    ] }, { ...query, mode: "stock-trend", stockCodes: ["00700"] }, "line");
    expect(new Set(spec.elements.chart.props.points.map((point) => point.series)).size).toBe(1);
  });
  it.each([
    { trading_currency: "USD" }, { stock_code: "700" }, { short_selling_value: "NaN" },
    { short_selling_value: "1e999" }, { first_date: "2026-02-30" },
    { source_url: "javascript:alert(1)" }, { source_url: "https://www.hkex.com.hk.evil.example/" },
  ])("rejects incompatible or malformed evidence: %j", (override) => {
    expect(() => buildHkexChart({ ...evidence, rows: [{ ...row, ...override }] }, query, "bar")).toThrow();
  });
  it("rejects empty, oversized or duplicate query results rather than fabricating a plot", () => {
    const missingMetric: DatabaseEvidence["rows"][number] = { ...row };
    delete missingMetric.short_selling_value;
    expect(() => buildHkexChart({ ...evidence, rows: [missingMetric] }, query, "bar")).toThrow("valid chart");
    expect(() => buildHkexChart({ ...evidence, rows: [] }, query, "bar")).toThrow("No retrieved rows");
    expect(() => buildHkexChart({ ...evidence, rows: Array(101).fill(row) }, query, "bar")).toThrow("valid chart");
    expect(() => buildHkexChart({ ...evidence, rows: [row, row] }, query, "bar")).toThrow("duplicate");
  });
  it("rejects chart types that misrepresent rankings or dated trends", () => {
    expect(() => buildHkexChart(evidence, query, "line")).toThrow("incompatible");
    expect(() => buildHkexChart(evidence, { ...query, mode: "market-trend" }, "bar")).toThrow("incompatible");
  });
  it("publishes eligible catalog choices and recommends horizontal bars for high-cardinality rankings", () => {
    const result = { ...evidence, rows: Array.from({ length: 7 }, (_, index) => ({ ...row, stock_code: String(index).padStart(5, "0") })) };
    const options = getHkexChartOptions(result, query);
    expect(options.recommendedComponent).toBe("HKEXHorizontalBarChart");
    expect(options.schema).toMatchObject({ category: "stock", pointCount: 7, seriesCount: 1, value: "decimal-string" });
    expect(options.choices.map((item) => item.component)).toEqual(["HKEXBarChart", "HKEXHorizontalBarChart", "HKEXDonutChart"]);
    expect(buildHkexChart(result, query, "horizontal-bar").elements.chart.type).toBe("HKEXHorizontalBarChart");
  });
  it("offers area for one temporal series but not multiple stocks or single-date data", () => {
    const result = { ...evidence, rows: [
      { ...row, trading_date: "2026-01-05" },
      { ...row, trading_date: "2026-01-06", last_date: "2026-01-06" },
    ] };
    const trend: HkexQuery = { ...query, mode: "stock-trend", stockCodes: ["00700"] };
    expect(getHkexChartOptions(result, trend).choices.map((item) => item.type)).toEqual(["line", "area"]);
    expect(hkexChartCatalog.validate(buildHkexChart(result, trend, "area")).success).toBe(true);
    const multiple = { ...result, rows: [...result.rows, { ...row, stock_code: "00005", trading_date: "2026-01-05" }] };
    expect(getHkexChartOptions(multiple, trend).choices.map((item) => item.type)).toEqual(["line"]);
    expect(() => buildHkexChart(multiple, trend, "area")).toThrow("incompatible");
    expect(getHkexChartOptions({ ...result, rows: [result.rows[0]] }, trend).choices.map((item) => item.type)).toEqual(["line"]);
  });
  it("allows a complete additive composition but rejects misleading donut charts", () => {
    const result = { ...evidence, rows: [row, { ...row, stock_code: "00005", stock_name: "HSBC" }] };
    expect(hkexChartCatalog.validate(buildHkexChart(result, query, "donut")).success).toBe(true);
    for (const invalid of [
      { ...result, truncated: true },
      evidence,
      { ...result, rows: [row, { ...row, stock_code: "00005", short_selling_value: null }] },
      { ...result, rows: result.rows.map((item) => ({ ...item, short_selling_value: "0" })) },
      { ...result, rows: Array.from({ length: 9 }, (_, index) => ({ ...row, stock_code: String(index).padStart(5, "0") })) },
    ]) expect(() => buildHkexChart(invalid, query, "donut")).toThrow("incompatible");
    expect(() => buildHkexChart(result, { ...query, metric: "short_turnover_percent" }, "donut")).toThrow("incompatible");
  });
  it("disallows generated actions, unknown components, extra nodes and dynamic bindings", () => {
    const spec = buildHkexChart(evidence, query, "bar");
    expect(hkexChartSpecSchema.safeParse({ ...spec, actions: {} }).success).toBe(false);
    expect(hkexChartSpecSchema.safeParse({ ...spec, elements: { ...spec.elements, extra: spec.elements.chart } }).success).toBe(false);
    expect(hkexChartSpecSchema.safeParse({ ...spec, elements: { chart: { ...spec.elements.chart, type: "Script" } } }).success).toBe(false);
    expect(hkexChartSpecSchema.safeParse({ ...spec, elements: { chart: { ...spec.elements.chart, type: "HKEXLineChart" } } }).success).toBe(false);
    expect(hkexChartSpecSchema.safeParse({ ...spec, elements: { chart: { ...spec.elements.chart, props: { ...spec.elements.chart.props, currency: { $state: "/key" } } } } }).success).toBe(false);
  });
});
