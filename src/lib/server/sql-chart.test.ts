import { describe, expect, it } from "vitest";
import { buildSqlChart, isChartable, profileColumns, type SqlChartChoice } from "./sql-chart";
import { buildSqlInsights } from "./sql-insights";

const result = (rows: Record<string, string | number | null>[], truncated = false) => ({ title: "Result", tables: ["public.insightful_dataset_rows"], rows, truncated });
const choice = (overrides: Partial<SqlChartChoice>): SqlChartChoice => ({ result: 0, type: "line", title: "Chart", labelColumn: "year", valueColumns: ["value"], seriesColumn: null, ...overrides });
const yearly = result([
  { year: "2022", value: "3.5" },
  { year: "2020", value: "1.25" },
  { year: "2021", value: null },
  { year: "2023", value: "2" },
]);

describe("SQL chart building", () => {
  it("profiles raw string rows into number, date and text columns", () => {
    expect(profileColumns([{ d: "2024-01-31", n: "-1.5e3", t: "HSBC", e: null }, { d: "2024-02-29 00:00:00", n: "7", t: "AIA", e: null }]).map(({ name, type }) => [name, type]))
      .toEqual([["d", "date"], ["n", "number"], ["t", "text"], ["e", "text"]]);
    expect(isChartable(result([{ entity: "A", gdp: "1" }]))).toBe(false);
    expect(isChartable(result([{ entity: "A" }, { entity: "B" }]))).toBe(false);
    expect(isChartable(result([{ entity: "A", gdp: "1" }, { entity: "B", gdp: "2" }]))).toBe(true);
  });

  it("orders time axes numerically and keeps missing values as nulls", () => {
    expect(buildSqlChart(yearly, choice({})).points).toEqual([
      { label: "2020", series: "value", value: 1.25 }, { label: "2021", series: "value", value: null },
      { label: "2022", series: "value", value: 3.5 }, { label: "2023", series: "value", value: 2 },
    ]);
  });

  it("splits long-format rows by a series column and keeps bar order from SQL", () => {
    const rows = result([
      { region: "Asia", fuel: "Coal", share: "50" }, { region: "Asia", fuel: "Solar", share: "10" },
      { region: "Europe", fuel: "Coal", share: "15" }, { region: "Europe", fuel: "Solar", share: "12" },
    ]);
    const chart = buildSqlChart(rows, choice({ type: "bar", labelColumn: "region", valueColumns: ["share"], seriesColumn: "fuel" }));
    expect(chart.points.map((point) => `${point.label}/${point.series}=${point.value}`)).toEqual(["Asia/Coal=50", "Asia/Solar=10", "Europe/Coal=15", "Europe/Solar=12"]);
    expect(() => buildSqlChart(rows, choice({ type: "bar", labelColumn: "region", valueColumns: ["share"] }))).toThrow("duplicate categories");
    expect(() => buildSqlChart(rows, choice({ type: "area", labelColumn: "region", valueColumns: ["share"], seriesColumn: "fuel" }))).toThrow("date or numeric axis");
  });

  it("rejects choices that are not grounded in the returned columns", () => {
    expect(() => buildSqlChart(yearly, choice({ labelColumn: "missing" }))).toThrow("not a returned column");
    expect(() => buildSqlChart(yearly, choice({ valueColumns: ["year"] }))).toThrow("numeric columns other than the axis");
    expect(() => buildSqlChart(yearly, choice({ seriesColumn: "value" }))).toThrow("separate returned column");
    expect(() => buildSqlChart(result([{ year: "2020", a: "1", b: "2" }, { year: "2021", a: "3", b: "4" }]), choice({ type: "area", valueColumns: ["a", "b"] }))).toThrow("single series");
    expect(() => buildSqlChart(result([{ year: "2020", value: "1" }, { year: "2021", value: null }]), choice({}))).toThrow("At least two numeric values");
    const many = result(Array.from({ length: 60 }, (_, index) => ({ year: String(1950 + index), a: "1", b: "2" })));
    expect(() => buildSqlChart(many, choice({ valueColumns: ["a", "b"] }))).toThrow("Too many points");
  });
});

describe("SQL insights", () => {
  it("summarises an ordered series with change, peak, low and the largest move", () => {
    const summary = buildSqlInsights(yearly)!;
    expect(summary.headline).toBe("value moved up from 1.25 (2020) to 2 (2023), +60%.");
    expect(summary.kpis.map((kpi) => [kpi.label, kpi.value, kpi.hint])).toEqual([
      ["Latest value", "2", "2023"], ["Change over period", "+0.75", "2020 to 2023"], ["Peak", "3.5", "2022"], ["Low", "1.25", "2020"],
    ]);
    expect(summary.insights.map((item) => item.title)).toEqual(["Overall change", "Highest point", "Lowest point", "Largest single move", "Missing values"]);
    expect(summary.insights.at(-1)?.text).toContain("1 of 4 rows have no value");
  });

  it("summarises a category ranking and flags partial results", () => {
    const summary = buildSqlInsights(result([
      { code: "00005", name: "HSBC", market_cap: "1200" }, { code: "00700", name: "Tencent", market_cap: "3600" },
      { code: "01299", name: "AIA", market_cap: "800" }, { code: "00941", name: "China Mobile", market_cap: "1600" },
    ], true))!;
    expect(summary.headline).toBe("Tencent has the highest market_cap among the returned rows at 3,600, 4.5x AIA.");
    expect(summary.kpis).toContainEqual({ label: "Returned-row total", value: "7,200", hint: "Returned rows only, not a full total" });
    expect(summary.insights.find((item) => item.kind === "concentration")?.text).toBe("The top 3 account for 88.9% of the returned total.");
    expect(summary.insights.at(-1)?.title).toBe("Partial results");
  });

  it("returns nothing when rows have no clear axis and measure", () => {
    expect(buildSqlInsights(result([{ id: "a" }, { id: "b" }]))).toBeNull();
    expect(buildSqlInsights(result([{ name: "A", value: "1" }]))).toBeNull();
    expect(buildSqlInsights(result([{ region: "Asia", fuel: "Coal", share: "1" }, { region: "Asia", fuel: "Solar", share: "2" }]))).toBeNull();
    expect(buildSqlInsights(result([{ name: "A", stock_code: "5" }, { name: "B", stock_code: "700" }]))).toBeNull();
  });
});
