import { afterEach, describe, expect, it, vi } from "vitest";
import { createHkexExplanationRunner, explanationInstructions, storeHkexExplanation } from "./hkex-explanation";
import type { DatabaseEvidence, HkexQuery } from "./hkex-database";

const query: HkexQuery = { mode: "ranking", from: null, to: null, stockCodes: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 10 };
const result: DatabaseEvidence = { sql: "SELECT", parameters: [], rows: [{ stock_code: "00700", short_selling_value: "12345.67" }], truncated: false };
afterEach(() => { vi.useRealTimers(); });
describe("server-held explanation references", () => {
  it("stores unique opaque references, not serialized client evidence", () => {
    const a = storeHkexExplanation("question", [{ query, result }]);
    const b = storeHkexExplanation("question", [{ query, result }]);
    expect(a).not.toBe(b);
    expect(a).not.toContain("00700");
    expect(createHkexExplanationRunner(a)).toBeTypeOf("function");
    expect(() => createHkexExplanationRunner({ rows: result.rows })).toThrow("Invalid");
  });
  it("expires evidence after fifteen minutes", () => {
    vi.useFakeTimers();
    const id = storeHkexExplanation("question", [{ query, result }]);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(() => createHkexExplanationRunner(id)).toThrow("expired");
  });
  it("bounds retained results to thirty-two entries", () => {
    const first = storeHkexExplanation("question", [{ query, result }]);
    for (let index = 0; index < 32; index++) storeHkexExplanation("question", [{ query, result }]);
    expect(() => createHkexExplanationRunner(first)).toThrow("expired");
  });
});

describe("explanation instructions", () => {
  it("adapts to the workspace and adds HKEX rules only for HKEX evidence", () => {
    const hk = explanationInstructions({ workspace: { name: "HK Equities Analyst", persona: "Portfolio manager" }, results: [] });
    expect(hk).toContain("HK Equities Analyst");
    expect(hk).toContain("units");
    expect(hk).toContain("recommendations");
    expect(hk).not.toContain("short interest");
    expect(explanationInstructions({ results: [{ query, result }] })).toContain("Short turnover ratio is not short interest");
  });
});

