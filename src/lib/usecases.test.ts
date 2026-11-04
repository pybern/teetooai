import { describe, expect, it } from "vitest";
import { DEFAULT_USE_CASE_ID, resolveUseCase, USE_CASES } from "./usecases";

describe("use case resolution", () => {
  it("defaults to HKEX Short-Selling Research, the first use case", () => {
    expect(DEFAULT_USE_CASE_ID).toBe(USE_CASES[0].id);
    for (const id of [null, undefined, "", "missing", "__proto__", "constructor"]) {
      expect(resolveUseCase(id).name).toBe("HKEX Short-Selling Research");
    }
  });

  it("keeps an explicitly requested use case", () => {
    expect(resolveUseCase("hk").name).toBe("HK Equities Analyst");
    expect(resolveUseCase("macro").id).toBe("macro");
  });
});
