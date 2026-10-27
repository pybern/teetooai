import { afterEach, describe, expect, it, vi } from "vitest";
import { createHkexRequestLimiter } from "./hkex-access";

function request() {
  return new Request("http://localhost/api/hkex/chat", { headers: { Origin: "http://localhost" } });
}
afterEach(() => { vi.useRealTimers(); });

describe("public HKEX request safeguards", () => {
  it("allows visitors without authorization while rejecting foreign browser origins", () => {
    const acquire = createHkexRequestLimiter();
    expect(acquire(request())).toBeTypeOf("function");
    const foreign = request();
    foreign.headers.set("origin", "https://foreign.example");
    expect(() => acquire(foreign)).toThrow("Cross-origin");
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    expect(() => acquire(crossSite)).toThrow("Cross-site");
  });
  it("bounds concurrent requests and releases slots idempotently", () => {
    const acquire = createHkexRequestLimiter();
    const first = acquire(request());
    const second = acquire(request());
    expect(() => acquire(request())).toThrow("shared request limit");
    first();
    first();
    const third = acquire(request());
    expect(() => acquire(request())).toThrow("shared request limit");
    second();
    third();
  });
  it("limits total starts across visitors to ten per minute, without trusting spoofable IP headers", () => {
    vi.useFakeTimers();
    const acquire = createHkexRequestLimiter();
    for (let i = 0; i < 10; i++) {
      const input = request();
      input.headers.set("x-forwarded-for", `192.0.2.${i}`);
      acquire(input)();
    }
    expect(() => acquire(request())).toThrow("shared request limit");
    vi.advanceTimersByTime(60000);
    const release = acquire(request());
    release();
  });
  it("keeps active slots bounded even after the start-rate window resets", () => {
    vi.useFakeTimers();
    const acquire = createHkexRequestLimiter();
    const first = acquire(request());
    const second = acquire(request());
    vi.advanceTimersByTime(60000);
    expect(() => acquire(request())).toThrow("shared request limit");
    first();
    acquire(request())();
    second();
  });
});
