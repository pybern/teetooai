import { describe, expect, it } from "vitest";
import { USE_CASES } from "../data";
import { runInsight } from ".";
import { parseQuestion } from "./parse";

const ids = (useCase: string) => USE_CASES.find((u) => u.id === useCase)!.datasetIds;

describe("every curated question produces a full report", () => {
  for (const uc of USE_CASES) {
    for (const { q } of uc.questions) {
      it(`${uc.id}: ${q}`, () => {
        const r = runInsight(q, uc.id);
        expect(r.charts.length).toBeGreaterThan(0);
        expect(r.kpis.length).toBeGreaterThan(0);
        expect(r.insights.length).toBeGreaterThan(0);
        expect(r.headline).not.toMatch(/NaN|undefined|Infinity/);
        for (const k of r.kpis) expect(`${k.value} ${k.delta ?? ""}`).not.toMatch(/NaN|undefined|Infinity/);
        for (const i of r.insights) expect(`${i.title} ${i.text}`).not.toMatch(/NaN|undefined|Infinity/);
      });
    }
  }
});

describe("parser routing", () => {
  const cases: [string, string, string, Partial<ReturnType<typeof parseQuestion>>][] = [
    ["hk", "How has the Hang Seng Index performed over the last 5 years?", "hk-indices", { intent: "trend", entities: ["Hang Seng Index"] }],
    ["hk", "Top 10 Hong Kong stocks by market cap", "hk-valuations", { intent: "rank", topN: 10, metrics: ["marketCap"] }],
    ["hk", "Which stocks are cheapest by P/E?", "hk-valuations", { intent: "rank", order: "asc", metrics: ["trailingPE"] }],
    ["hk", "Compare Tencent, Alibaba and Meituan stock performance", "hk-prices", { intent: "compare", entities: ["Tencent", "Alibaba", "Meituan"] }],
    ["hk", "Market cap breakdown by sector", "hk-valuations", { intent: "share", groupBy: "sector" }],
    ["hk", "Relationship between P/E and dividend yield", "hk-valuations", { intent: "correlation", metrics: ["trailingPE", "dividendYield"] }],
    ["hk", "Tencent revenue and profit trend", "hk-financials", { intent: "trend", entities: ["Tencent"], metrics: ["revenue", "netIncome"] }],
    ["hk", "Which company grew net income fastest?", "hk-financials", { intent: "growth", metrics: ["netIncome"] }],
    ["hk", "Forecast the Hang Seng Index to 2027", "hk-indices", { intent: "forecast", targetYear: 2027 }],
    ["hk", "China Mobile valuation", "hk-valuations", { intent: "snapshot", entities: ["China Mobile"] }],
    ["macro", "Is there a relationship between inflation and the fed funds rate?", "us-macro", { intent: "correlation" }],
    ["macro", "Break down GDP by region", "world-economy", { intent: "share", groupBy: "region" }],
    ["climate", "Fossil vs clean share of electricity", "electricity-mix", { intent: "share", groupBy: "category" }],
    ["climate", "Compare solar and wind growth", "renewables-growth", { intent: "compare" }],
    ["tech", "Compare Nvidia and Microsoft net income", "big-tech", { intent: "compare", metrics: ["netIncome"] }],
    ["ev", "Forecast EV sales to 2030", "ev-global", { intent: "forecast", targetYear: 2030 }],
  ];
  for (const [uc, q, ds, expected] of cases) {
    it(q, () => {
      const it2 = parseQuestion(q, ids(uc));
      expect(it2.datasetId).toBe(ds);
      expect(it2).toMatchObject(expected);
    });
  }
});

describe("numbers are computed from the data", () => {
  it("ranks HK market cap leader correctly", () => {
    const r = runInsight("Top 5 Hong Kong stocks by market cap", "hk");
    expect(r.table.rows[0].entity).toBe("Tencent");
  });
  it("forecast EV sales grows", () => {
    const r = runInsight("Forecast EV sales to 2030", "ev");
    const last = r.table.rows[r.table.rows.length - 1];
    expect(Number(last.forecast)).toBeGreaterThan(17.3);
  });
  it("detects the 2020 unemployment spike", () => {
    const r = runInsight("Detect anomalies in US unemployment", "macro");
    expect(r.headline).toContain("2020");
  });
});
