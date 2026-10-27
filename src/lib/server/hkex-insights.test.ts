import { describe, expect, it } from "vitest";
import { buildHkexInsights } from "./hkex-insights";
import type { DatabaseEvidence, HkexQuery } from "./hkex-database";

const query: HkexQuery = { mode: "ranking", from: null, to: null, stockCodes: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 10 };
const row = {
  stock_code: "00700", stock_name: "TENCENT", trading_currency: "HKD",
  first_date: "2026-01-05", last_date: "2026-01-05", short_selling_value: "300",
};
const evidence: DatabaseEvidence = { sql: "SELECT", parameters: [], rows: [row], truncated: false };
const kpi = (summary: ReturnType<typeof buildHkexInsights>, label: string) => summary.kpis.find((item) => item.label === label)?.value;
function daily(date: string, value: string | null, code = "00700") {
  return { ...row, stock_code: code, stock_name: code === "00700" ? "TENCENT" : "HSBC", trading_date: date, first_date: date, last_date: date, short_selling_value: value };
}
const trend: HkexQuery = { ...query, mode: "stock-trend", stockCodes: ["00700"] };

describe("factual insights from returned HKEX evidence", () => {
  it("computes ranking leader, exact total and concentration only within returned stocks", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [{ ...row, stock_code: "00005", short_selling_value: "100" }, row] }, query);
    expect(summary.headline).toContain("00700 TENCENT");
    expect(kpi(summary, "Returned-stock total")).toBe("HKD 400");
    expect(kpi(summary, "Highest stock's share")).toBe("75%");
    expect(summary.insights.find((item) => item.kind === "concentration")?.text).toContain("This is not a market share");
    expect(summary.insights.every((item) => item.tone === "neutral" || item.tone === "warning")).toBe(true);
  });
  it("compares and sums exact decimals beyond Number.MAX_SAFE_INTEGER", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...row, short_selling_value: "9007199254740993.11" },
      { ...row, stock_code: "00005", stock_name: "HSBC", short_selling_value: "9007199254740993.12" },
    ] }, query);
    expect(summary.headline).toContain("00005 HSBC");
    expect(kpi(summary, "Returned-stock total")).toBe("HKD 18,014,398,509,481,986.23");
    expect(kpi(summary, "Highest stock's share")).toBe("50%");
  });
  it("aligns mixed decimal scales and rounds shares to two decimal places", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...row, short_selling_value: "0.1" },
      { ...row, stock_code: "00005", short_selling_value: "0.20" },
    ] }, query);
    expect(kpi(summary, "Returned-stock total")).toBe("HKD 0.3");
    expect(kpi(summary, "Highest stock's share")).toBe("66.67%");
  });
  it("labels ties rather than inventing a unique winner", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [row, { ...row, stock_code: "00005" }] }, query);
    expect(summary.headline).toContain("tie for the highest");
  });
  it("never adds or averages ratios or describes them as short interest", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...row, short_turnover_percent: "12.5" }, { ...row, stock_code: "00005", short_turnover_percent: "25.5" },
    ] }, { ...query, metric: "short_turnover_percent" });
    expect(kpi(summary, "Highest returned value")).toBe("25.5%");
    expect(kpi(summary, "Returned-stock total")).toBeUndefined();
    expect(kpi(summary, "Highest stock's share")).toBeUndefined();
    expect(summary.insights.at(-1)?.text).toContain("Ratios are not added or averaged");
  });
  it("keeps missing values unavailable and withholds incomplete additive totals", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [row, { ...row, stock_code: "00005", short_selling_value: null }] }, query);
    expect(kpi(summary, "Returned-stock total")).toBe("Unavailable");
    expect(kpi(summary, "Highest stock's share")).toBeUndefined();
    expect(summary.insights.at(-1)?.text).toContain("not replaced with zero");
  });
  it("handles all-null and empty results without inventing a leader or zero activity", () => {
    const unavailable = buildHkexInsights({ ...evidence, rows: [{ ...row, short_selling_value: null }] }, query);
    expect(unavailable.headline).toContain("unavailable");
    expect(unavailable.insights.some((item) => item.kind === "comparison")).toBe(false);
    const empty = buildHkexInsights({ ...evidence, rows: [] }, query);
    expect(empty.headline).toContain("no activity level can be inferred");
    expect(kpi(empty, "Highest returned value")).toBe("Unavailable");
  });
  it("does not divide by zero for zero-valued rankings", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...row, short_selling_value: "0" }, { ...row, stock_code: "00005", short_selling_value: "0" },
    ] }, query);
    expect(kpi(summary, "Returned-stock total")).toBe("HKD 0");
    expect(kpi(summary, "Highest stock's share")).toBeUndefined();
  });
  it("sorts daily observations, computes endpoint change and finds the observed peak", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      daily("2026-01-07", "125"), daily("2026-01-05", "100"), daily("2026-01-06", "200"),
    ] }, trend);
    expect(kpi(summary, "Latest returned value")).toBe("HKD 125");
    expect(kpi(summary, "Change vs first returned")).toBe("25%");
    expect(summary.insights[0].text).toContain("Highest observed value: HKD 200 on 2026-01-06");
    expect(summary.scope).toContain("2026-01-05 to 2026-01-07");
  });
  it("reports falling trends neutrally without a good/bad investment signal", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [daily("2026-01-05", "3"), daily("2026-01-06", "2")] }, trend);
    expect(kpi(summary, "Change vs first returned")).toBe("-33.33%");
    expect(summary.kpis.some((item) => item.good !== undefined)).toBe(false);
  });
  it("uses percentage-point changes for turnover ratios, including a zero baseline", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...daily("2026-01-05", "100"), short_turnover_percent: "0" },
      { ...daily("2026-01-06", "200"), short_turnover_percent: "2.125" },
    ] }, { ...trend, metric: "short_turnover_percent" });
    expect(kpi(summary, "Change vs first returned")).toBe("2.125 percentage points");
  });
  it("does not compute percentage change against zero or bridge null endpoints", () => {
    for (const value of ["0", null]) {
      const summary = buildHkexInsights({ ...evidence, rows: [daily("2026-01-05", value), daily("2026-01-07", "30")] }, trend);
      expect(kpi(summary, "Change vs first returned")).toBe("Unavailable");
      expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity/);
    }
    const missingLast = buildHkexInsights({ ...evidence, rows: [daily("2026-01-05", "20"), daily("2026-01-07", null)] }, trend);
    expect(kpi(missingLast, "Latest returned value")).toBe("Unavailable");
  });
  it("does not infer change from a single observation or assume consecutive dates", () => {
    const single = buildHkexInsights({ ...evidence, rows: [daily("2026-01-05", "10")] }, trend);
    expect(kpi(single, "Change vs first returned")).toBe("Unavailable");
    const gaps = buildHkexInsights({ ...evidence, rows: [daily("2026-01-05", "10"), daily("2026-01-10", "15")] }, trend);
    expect(kpi(gaps, "Stored dates")).toBe("2");
  });
  it("compares each stock separately, never merging mixed stock-series endpoints", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      daily("2026-01-05", "100"), daily("2026-01-07", "200"),
      daily("2026-01-05", "1000", "00005"), daily("2026-01-06", "500", "00005"),
    ] }, { ...trend, stockCodes: ["00700", "00005"] });
    expect(summary.headline).toContain("2 separate stock series");
    expect(summary.insights[0].text).toContain("100%");
    expect(summary.insights[1].text).toContain("-50%");
    expect(kpi(summary, "Latest returned value")).toBeUndefined();
    expect(kpi(summary, "Returned-stock total")).toBeUndefined();
  });
  it("supports filtered market trends, share counts and non-HKD currencies", () => {
    const summary = buildHkexInsights({ ...evidence, rows: [
      { ...daily("2026-01-05", "10"), trading_currency: "CNY", short_selling_shares: "150" },
      { ...daily("2026-01-06", "20"), trading_currency: "CNY", short_selling_shares: "200" },
    ] }, { ...trend, mode: "market-trend", currency: "CNY", metric: "short_selling_shares" });
    expect(summary.title).toContain("CNY");
    expect(summary.headline).toContain("Selected-stock daily total");
    expect(kpi(summary, "Latest returned value")).toBe("200 shares");
    expect(kpi(summary, "Change vs first returned")).toBe("33.33%");
  });
  it("labels row-limited findings as a returned subset, not a full period", () => {
    const summary = buildHkexInsights({ ...evidence, truncated: true }, query);
    expect(summary.insights.at(-1)?.text).toContain("not the full ranking or period");
  });
  it.each([
    { trading_currency: "USD" }, { stock_code: "market" }, { stock_code: "700" },
    { first_date: "not a date" }, { last_date: "2026-01-01" },
    { short_selling_value: "-1" }, { short_selling_value: "NaN" }, { short_selling_value: "1e20" },
    { short_selling_value: 9007199254740992 }, { short_selling_value: "9".repeat(81) },
  ])("rejects inconsistent or non-exact evidence: %j", (changes) => {
    expect(() => buildHkexInsights({ ...evidence, rows: [{ ...row, ...changes }] }, query)).toThrow("cannot form valid HKEX insights");
  });
  it("rejects duplicate stocks/dates and inconsistent daily ranges", () => {
    expect(() => buildHkexInsights({ ...evidence, rows: [row, row] }, query)).toThrow("cannot form valid");
    const point = daily("2026-01-05", "20");
    expect(() => buildHkexInsights({ ...evidence, rows: [point, point] }, trend)).toThrow("cannot form valid");
    expect(() => buildHkexInsights({ ...evidence, rows: [{ ...point, last_date: "2026-01-06" }] }, trend)).toThrow("cannot form valid");
  });
});
