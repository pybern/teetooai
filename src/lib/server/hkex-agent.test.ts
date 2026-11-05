import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendModelChat } from "@/lib/model-chat-stream";
import { DEFAULT_CONNECTIONS, HKEX_SERVER_TIMEOUT_MS, type ModelChatToolActivity, type OutputTokenLimits, type ReasoningEffort } from "@/lib/connections";
import { loadConnections, saveConnection } from "./connections";
import { hkexPlanSchema, MAX_PLAN_REPAIRS } from "./hkex-agent";
import { POST } from "@/app/api/hkex/chat/route";
import { POST as INSIGHT } from "@/app/api/insight/route";
import { GET as CONFIG } from "@/app/api/config/route";
import { POST as INITIALIZE } from "@/app/api/config/database/initialize/route";
import * as access from "./hkex-access";
import * as agent from "./hkex-agent";
import { buildCatalogEntries } from "./table-catalog";

const pg = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock("pg", () => ({ Client: class { connect = pg.connect; query = pg.query; end = pg.end; on = pg.on; } }));
const token = "test-hkex-agent-administrator-32-characters";
const queryInput = { mode: "ranking", from: null, to: null, stockCodes: [], stockSearches: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 10, chart: null };
const evidence = { stock_code: "00700", stock_name: "TENCENT", short_selling_value: "12345.67", trading_currency: "HKD", first_date: "2026-01-05", last_date: "2026-01-05", source_url: "https://www.hkex.com.hk/example" };
let server: Server;
let directory: string;
let baseUrl: string;
let calls: Record<string, unknown>[];
let plan: unknown;
let providerStatus = 200;
let explanation = false;
let supportedEfforts: ReasoningEffort[];
let finishReason = "stop";
let reasoning = "Select the supported query.";
let script: string[] | undefined;
let chartCalls: Record<string, unknown>[];
let chartChoice: unknown;
let chartStatus = 200;
let chartGate: Promise<void> | undefined;
function toolCall(name: string, input: unknown, id = `call_${name}`) {
  return chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(input) } }] }) +
    chunk({}, "tool_calls") + "data: [DONE]\n\n";
}
function request(body: unknown = { messages: [{ role: "user", content: "Rank HKD short-selling stocks." }] }) {
  return new Request("http://localhost/api/hkex/chat", {
    method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function chunk(delta: unknown, reason: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hkex-planner-"));
  server = createServer(async (req, response) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-model", reasoning_options: [{ type: "effort", values: supportedEfforts }] }] }));
      return;
    }
    let raw = "";
    for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw);
    if (body.response_format?.json_schema?.name === "sqlChartChoice") {
      chartCalls.push(body);
      await chartGate;
      if (chartStatus !== 200) { response.writeHead(chartStatus); response.end("private upstream details"); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(chunk({ content: JSON.stringify(chartChoice) }, "stop") + "data: [DONE]\n\n");
      return;
    }
    calls.push(body);
    if (providerStatus !== 200) { response.writeHead(providerStatus); response.end("private upstream details"); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (script) { response.end(script[calls.length - 1] ?? chunk({ content: JSON.stringify(plan) }, "stop") + "data: [DONE]\n\n"); return; }
    response.end(chunk({ reasoning_content: reasoning }) +
      chunk({ content: explanation ? "## Explanation\n\nTENCENT: HKD 12345.67, based on retrieved evidence." : JSON.stringify(plan) }, finishReason) + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No provider fixture address");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
beforeEach(() => {
  calls = []; providerStatus = 200; explanation = false; script = undefined;
  chartCalls = []; chartChoice = { charts: [] }; chartStatus = 200; chartGate = undefined;
  supportedEfforts = ["none", "minimal", "low", "medium", "high"];
  finishReason = "stop"; reasoning = "Select the supported query.";
  plan = { clarification: null, queries: [{ ...queryInput }], sqlQueries: [] };
  vi.stubEnv("CONFIG_ADMIN_TOKEN", "");
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("CONNECTION_CONFIG_PATH", path.join(directory, `${crypto.randomUUID()}.json`));
  vi.clearAllMocks();
  vi.spyOn(access, "acquireHkexRequest").mockImplementation(access.createHkexRequestLimiter());
  pg.connect.mockResolvedValue(undefined); pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "stock_code", data_type: "text", is_nullable: "NO" }] };
    if (sql.includes("count(DISTINCT stock_code)")) return { rows: [{ first_date: "2026-01-02", last_date: "2026-01-05", trading_currency: "HKD", board: "Main Board", rows: "2" }] };
    if (sql.startsWith("WITH latest")) return { rows: [evidence] };
    if (sql.includes("stock_name ILIKE")) return { rows: [evidence] };
    return { rows: [] };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
async function saveSettings(reasoningEffort?: ReasoningEffort, outputTokens?: OutputTokenLimits) {
  await saveConnection("database", { ...DEFAULT_CONNECTIONS.database, host: "fixture-db", database: "fixture", username: "reader", password: "db-secret" });
  await saveConnection("api", { baseUrl, model: "fixture-model", apiKey: "fixture-api-key", reasoningEffort, outputTokens });
}
function interceptChat() {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => url === "/api/hkex/chat"
    ? POST(new Request("http://localhost/api/hkex/chat", init)) : realFetch(url, init));
}
async function research(onTools = vi.fn(), useCaseId = "hkex-db") {
  return sendModelChat(undefined, [{ role: "user", content: "Chart HKD short selling." }], new AbortController().signal, vi.fn(), vi.fn(), { api: "/api/hkex/chat", onTools, useCaseId });
}
describe("single-call HKEX research", () => {
  it.each(["hk", "hkex-db"])("plans and renders exact factual results without a catalog in one provider request for %s", async (useCaseId) => {
    await saveSettings(); interceptChat();
    const result = await research(vi.fn(), useCaseId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "fixture-model", stream: true, max_tokens: 4096, reasoning_effort: "low" });
    expect(calls[0].tools).toBeUndefined();
    expect(calls[0].response_format).toMatchObject({ type: "json_schema", json_schema: { name: "hkexResearchPlan", strict: true } });
    expect(JSON.stringify(calls[0].messages)).toContain("2026-01-05");
    expect(JSON.stringify(calls[0].messages)).toContain("NOT short interest");
    expect(JSON.stringify(calls[0].messages)).not.toContain("12345.67");
    expect(JSON.stringify(calls)).not.toMatch(/db-secret|fixture-api-key/);
    expect(result.message.content).toContain("## Results");
    expect(result.message.content).not.toMatch(/model call|Server-generated|tokens|tool calls/i);
    expect(result.message.content).toContain("00700 TENCENT");
    expect(result.message.content).toContain("12345.67");
    expect(result.message.content).toContain("https://www.hkex.com.hk/example");
    expect(result.baseUrl).toBe("");
    expect(result.reasoning).toBe("Select the supported query.");
    expect(pg.query.mock.calls.filter(([sql]) => sql.startsWith("WITH latest"))).toHaveLength(1);
    expect(pg.query.mock.calls.some(([sql]) => /^DELETE|^INSERT|^UPDATE|^CREATE/.test(sql))).toBe(false);
    expect(result.tools?.find((item) => item.explanationId)?.explanationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.tools?.find((item) => item.tool === "computeInsights")?.insights).toMatchObject({
      headline: expect.stringContaining("00700 TENCENT"),
      kpis: expect.arrayContaining([{ label: "Returned-stock total", value: "HKD 12,345.67", hint: "Returned rows only, not a market total" }]),
    });
  });
  it.each(["medium", "high"] as const)("uses low research effort without overwriting saved %s", async (effort) => {
    await saveSettings(effort); interceptChat();
    await research();
    expect(calls[0].reasoning_effort).toBe("low");
    expect((await loadConnections()).api.reasoningEffort).toBe(effort);
  });
  it.each(["none", "minimal"] as const)("does not increase a saved %s effort", async (effort) => {
    await saveSettings(effort); interceptChat();
    await research();
    expect(calls[0].reasoning_effort).toBe(effort);
  });
  it("preserves a valid saved effort when low is not advertised", async () => {
    supportedEfforts = ["medium", "high"];
    await saveSettings("high"); interceptChat();
    await research();
    expect(calls[0].reasoning_effort).toBe("high");
  });
  it("does not invent effort support when the catalog advertises none", async () => {
    supportedEfforts = [];
    await saveSettings(); interceptChat();
    await research();
    expect(calls[0].reasoning_effort).toBeUndefined();
  });
  it("rejects unsupported saved effort when low is also unavailable", async () => {
    supportedEfforts = ["medium"];
    await saveSettings("high");
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("does not advertise");
    expect(calls).toHaveLength(0);
  });
  it("reports a planner token limit before validating JSON or querying data", async () => {
    await saveSettings(); interceptChat();
    finishReason = "length";
    plan = "truncated JSON";
    await expect(research()).rejects.toThrow("4,096-token output limit");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it("applies the configured planning limit to the request and the token-limit message", async () => {
    await saveSettings(undefined, { planning: 12000 }); interceptChat();
    finishReason = "length";
    plan = "truncated JSON";
    await expect(research()).rejects.toThrow("Research planning reached its 12,000-token output limit");
    expect(calls[0]).toMatchObject({ max_tokens: 12000 });
  });
  it("clips long research thinking for display instead of failing the turn", async () => {
    await saveSettings(); interceptChat();
    reasoning = "x".repeat(20000);
    const result = await research();
    expect(result.message.content).toContain("## Results");
    expect(result.reasoning).toHaveLength(16000 + "\n\n[Thinking shortened for display.]".length);
    expect(result.reasoning?.endsWith("[Thinking shortened for display.]")).toBe(true);
  });
  it("reports the server deadline as a timeout, not user cancellation", async () => {
    await saveSettings();
    const deadline = new AbortController();
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === HKEX_SERVER_TIMEOUT_MS ? deadline.signal : realTimeout(ms));
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (url === "/api/hkex/chat") return POST(new Request("http://localhost/api/hkex/chat", init));
      if (String(url).endsWith("/chat/completions")) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(chunk({ reasoning_content: "Planning." })));
            init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
            setTimeout(() => deadline.abort(new DOMException("Timeout", "TimeoutError")), 20);
          },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return realFetch(url, init);
    });
    await expect(research()).rejects.toThrow(`timed out after ${HKEX_SERVER_TIMEOUT_MS / 1000} seconds`);
    expect(timeout).toHaveBeenCalledWith(HKEX_SERVER_TIMEOUT_MS);
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it.each(["auto", "HKEXHorizontalBarChart"])("renders a %s catalog chart without a chart or narrative model call", async (chart) => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, chart }], sqlQueries: [] };
    const onTools = vi.fn<(tools: ModelChatToolActivity[]) => void>();
    const result = await research(onTools);
    expect(calls).toHaveLength(1);
    expect(result.tools?.find((item) => item.chart)?.chart?.elements.chart.props.points[0].value).toBe("12345.67");
    expect(result.tools?.find((item) => item.chart)?.chart?.elements.chart.type).toBe(chart === "auto" ? "HKEXBarChart" : chart);
  });
  it("reports an incompatible chart while retaining valid query results", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, chart: "HKEXAreaChart" }], sqlQueries: [] };
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.message.content).toContain("This chart isn't available");
    expect(result.message.content).toContain("12345.67");
    expect(result.tools?.some((item) => item.chart)).toBe(false);
  });
  it("resolves stock names server-side before querying, without additional model calls", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, stockSearches: ["Tencent"] }], sqlQueries: [] };
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.tools?.find((item) => item.tool === "findStocks")?.status).toBe("complete");
    expect(pg.query.mock.calls.find(([sql]) => sql.startsWith("WITH latest"))?.[1][4]).toEqual(["00700"]);
  });
  it("deduplicates concurrent lookups and overlaps independent queries while retaining answer order", async () => {
    await saveSettings(); interceptChat();
    pg.connect.mockClear(); pg.query.mockClear(); pg.end.mockClear();
    plan = { clarification: null, queries: [
      { ...queryInput, stockSearches: ["Tencent"] },
      { ...queryInput, stockSearches: ["HSBC"] },
      { ...queryInput, stockSearches: ["Tencent", "HSBC"] },
    ], sqlQueries: [] };
    const original = pg.query.getMockImplementation()!;
    const lookups: (() => void)[] = [];
    const queries: (() => void)[] = [];
    pg.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
      if (sql.includes("stock_name ILIKE")) {
        return new Promise((resolve) => {
          lookups.push(() => resolve({ rows: [{ ...evidence, stock_code: parameters[1] === "%HSBC%" ? "00005" : "00700" }] }));
          if (lookups.length === 2) lookups.forEach((release) => release());
        });
      }
      if (sql.startsWith("WITH latest")) {
        expect(lookups).toHaveLength(2);
        const codes = parameters[4] as string[];
        const stock_name = codes.length === 2 ? "Third query" : codes[0] === "00700" ? "First query" : "Second query";
        return new Promise((resolve) => {
          queries.push(() => resolve({ rows: [{ ...evidence, stock_name }] }));
          if (queries.length === 3) [...queries].reverse().forEach((release) => release());
        });
      }
      return original(sql, parameters);
    });
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.tools?.filter((item) => item.tool === "findStocks")).toHaveLength(2);
    expect(result.tools?.filter((item) => item.tool === "queryHkex")).toHaveLength(3);
    expect(result.message.content.indexOf("First query")).toBeLessThan(result.message.content.indexOf("Second query"));
    expect(result.message.content.indexOf("Second query")).toBeLessThan(result.message.content.indexOf("Third query"));
    // Six research connections plus the saved-model configuration read.
    expect(pg.connect).toHaveBeenCalledTimes(7);
    // Includes the preflight check for the table catalog.
    expect(pg.query).toHaveBeenCalledTimes(21);
    expect(pg.end).toHaveBeenCalledTimes(7);
  });
  it("streams the answer section by section, starting before the data queries finish", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput }, { ...queryInput, currency: "CNY" }], sqlQueries: [] };
    const original = pg.query.getMockImplementation()!;
    const pending: (() => void)[] = [];
    pg.query.mockImplementation(async (sql: string, parameters: unknown[]) => sql.startsWith("WITH latest")
      ? new Promise((resolve) => pending.push(() => resolve({ rows: [{ ...evidence, trading_currency: parameters[2] }] })))
      : original(sql, parameters));
    const texts: string[] = [];
    const done = sendModelChat(undefined, [{ role: "user", content: "Rank" }], new AbortController().signal, (text) => texts.push(text), vi.fn(), { api: "/api/hkex/chat" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await vi.waitFor(() => expect(texts.at(-1)).toBe("## Results\n\n"));
    pending[0]();
    await vi.waitFor(() => expect(texts.at(-1)).toContain("Currency: **HKD**"));
    expect(texts.at(-1)).not.toContain("Currency: **CNY**");
    pending[1]();
    const result = await done;
    expect(result.message.content.indexOf("Currency: **HKD**")).toBeLessThan(result.message.content.indexOf("Currency: **CNY**"));
  });

  it("validates every resolved query before starting any parallel data reads", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [
      { ...queryInput },
      { ...queryInput, from: "2026-02-30", to: "2026-03-02" },
    ], sqlQueries: [] };
    await expect(research()).rejects.toThrow("Invalid HKEX filters");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it("asks for clarification on ambiguous stock names rather than looping or guessing", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, stockSearches: ["bank"] }], sqlQueries: [] };
    const original = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string) => sql.includes("stock_name ILIKE")
      ? { rows: [evidence, { ...evidence, stock_code: "00005" }] } : original(sql));
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.message.content).toContain("Clarification needed");
    expect(result.message.content).toContain("00005");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
    expect(result.tools?.some((item) => item.explanationId)).toBe(false);
    expect(result.tools?.some((item) => item.insights)).toBe(false);
  });
  it("handles unsupported requests with one planner clarification and no data query", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: "Prices require an additional dataset.", queries: [], sqlQueries: [] };
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.message.content).toContain("Prices require");
    expect(result.tools?.some((item) => item.insights)).toBe(false);
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it("does not fabricate values when a supported query returns no rows", async () => {
    await saveSettings(); interceptChat();
    const original = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string) => sql.startsWith("WITH latest") ? { rows: [] } : original(sql));
    const result = await research();
    expect(result.message.content).toContain("No matching data");
    expect(result.tools?.find((item) => item.insights)?.insights?.headline).toContain("no activity level can be inferred");
    expect(result.tools?.some((item) => item.explanationId)).toBe(false);
  });
  it("rejects malformed plans and invalid date ranges without executing data queries", async () => {
    await saveSettings();
    for (const badPlan of [{ sql: "DELETE FROM private" }, { clarification: null, queries: [{ ...queryInput, from: "2026-02-30", to: "2026-03-02" }], sqlQueries: [] }]) {
      plan = badPlan;
      const body = await (await POST(request())).text();
      expect(body).not.toContain('"completed":true');
      expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
    }
  });
  it("validates plan-level query/lookup limits", () => {
    expect(hkexPlanSchema.safeParse({ clarification: null, queries: Array(4).fill(queryInput), sqlQueries: [] }).success).toBe(false);
    expect(hkexPlanSchema.safeParse({ clarification: null, queries: Array(3).fill({ ...queryInput, stockSearches: ["a", "b"] }), sqlQueries: [] }).success).toBe(false);
    expect(hkexPlanSchema.safeParse({ clarification: "Ambiguous", queries: [queryInput], sqlQueries: [] }).success).toBe(false);
  });
  it("makes one additional model request only for explicit explanations using server-held evidence", async () => {
    await saveSettings(); interceptChat();
    const result = await research();
    const id = result.tools!.find((item) => item.explanationId)!.explanationId!;
    expect(calls).toHaveLength(1);
    pg.query.mockClear();
    explanation = true;
    const explanationResult = await sendModelChat(undefined, [], new AbortController().signal, vi.fn(), undefined, { api: "/api/hkex/chat", explanationId: id });
    expect(calls).toHaveLength(2);
    expect(calls[1].response_format).toBeUndefined();
    expect(calls[1].tools).toBeUndefined();
    expect(calls[1]).toMatchObject({ max_tokens: 4096, reasoning_effort: "low" });
    expect(JSON.stringify(calls[1].messages)).toContain("12345.67");
    expect(explanationResult.message.content).toContain("## Explanation");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest") || sql.includes("information_schema.columns"))).toBe(false);
  });
  it("rejects unknown or expired explanation references before provider or database access", async () => {
    expect((await POST(request({ explanationId: crypto.randomUUID() }))).status).toBe(410);
    expect((await POST(request({ explanationId: "invalid" }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(pg.connect).not.toHaveBeenCalled();
  });
  it("does not label a token-truncated optional explanation as completed", async () => {
    await saveSettings(); interceptChat();
    const result = await research();
    const id = result.tools!.find((item) => item.explanationId)!.explanationId!;
    pg.query.mockClear();
    explanation = true;
    finishReason = "length";
    await expect(sendModelChat(undefined, [], new AbortController().signal, vi.fn(), undefined, { api: "/api/hkex/chat", explanationId: id }))
      .rejects.toThrow("The explanation reached its 4,096-token output limit");
    expect(calls).toHaveLength(2);
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it("retains the single bounded 503 retry but never retries 429", async () => {
    await saveSettings();
    const realFetch = globalThis.fetch;
    let attempts = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/models")) return realFetch(url, init);
      if (++attempts === 1) return new Response("private", { status: 503 });
      return realFetch(url, init);
    });
    const body = await (await POST(request())).text();
    expect(body).toContain('"completed":true');
    expect(attempts).toBe(2);
    expect(calls).toHaveLength(1);
    fetchSpy.mockRestore();
    providerStatus = 429;
    const limited = vi.spyOn(globalThis, "fetch");
    const failed = await (await POST(request())).text();
    expect(failed).toContain("HTTP 429");
    expect(failed).not.toContain('"completed":true');
    expect(limited.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"))).toHaveLength(1);
  });
  it("stops after one retry if 503 persists, without exposing the upstream body", async () => {
    await saveSettings(); providerStatus = 503;
    const spy = vi.spyOn(globalThis, "fetch");
    const body = await (await POST(request())).text();
    expect(spy.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"))).toHaveLength(2);
    expect(body).toContain("already used its single");
    expect(body).not.toContain("private upstream");
    expect(body).not.toContain('"completed":true');
  });
  it("cancels pending 503 retries on disconnect", async () => {
    await saveSettings();
    const controller = new AbortController();
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/models")) return realFetch(url, init);
      setTimeout(() => controller.abort(), 20);
      return new Response("private", { status: 503 });
    });
    const response = await POST(new Request(request(), { signal: controller.signal }));
    const body = await response.text();
    expect(body).not.toContain('"completed":true');
    expect(body).toContain("cancelled");
    expect(spy.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"))).toHaveLength(1);
  });
  it("rejects foreign origins, invalid conversations and absent settings without model calls", async () => {
    const foreign = request(); foreign.headers.set("origin", "https://foreign.example");
    expect((await POST(foreign)).status).toBe(403);
    expect((await POST(request({ messages: [] }))).status).toBe(400);
    expect((await POST(request())).status).toBe(409);
    expect(calls).toHaveLength(0);
  });
  it("keeps configuration and initialization administrator-protected", async () => {
    vi.stubEnv("CONFIG_ADMIN_TOKEN", token);
    expect((await CONFIG(new Request("http://localhost/api/config"))).status).toBe(401);
    expect((await INITIALIZE(new Request("http://localhost/api/config/database/initialize", { method: "POST" }))).status).toBe(401);
  });
  it("fails database preflight before model charges and sanitizes later query failures", async () => {
    await saveSettings();
    const original = pg.query.getMockImplementation()!;
    pg.query.mockResolvedValue({ rows: [] });
    expect((await POST(request())).status).toBe(409);
    expect(calls).toHaveLength(0);
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("WITH latest")) throw Object.assign(new Error("db-secret"), { code: "42501" });
      return original(sql);
    });
    const body = await (await POST(request())).text();
    expect(body).toContain("SELECT access");
    expect(body).not.toContain("db-secret");
    expect(body).not.toContain('"completed":true');
  });
  it("holds shared slots through execution and releases them after cancellation", async () => {
    await saveSettings();
    const release = vi.fn();
    vi.mocked(access.acquireHkexRequest).mockReturnValue(release);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    vi.spyOn(agent, "createHkexRunner").mockReturnValue(async function* (options) {
      await new Promise<void>((resolve) => { options.abortSignal.addEventListener("abort", () => resolve(), { once: true }); started(); });
      yield* [];
    });
    const response = await POST(request()); await ready;
    expect(release).not.toHaveBeenCalled();
    await response.body!.cancel();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
  });
  it("never silently falls back to the deterministic engine", async () => {
    const response = await INSIGHT(new Request("http://localhost/api/insight", { method: "POST", body: JSON.stringify({ question: "HKEX", useCaseId: "hkex-db" }) }));
    expect(response.status).toBe(400);
  });
});

describe("structured plan validation and repair", () => {
  const cases = [
    { name: "missing output", text: "", diagnostic: "Missing output" },
    { name: "malformed JSON", text: '{"private-secret":', diagnostic: "Malformed JSON" },
    { name: "schema mismatch", text: JSON.stringify({ clarification: null, queries: [{ ...queryInput, limit: "private-secret" }], sqlQueries: [] }), diagnostic: "queries.0.limit: missing field or incorrect type" },
    { name: "empty plan", text: JSON.stringify({ clarification: null, queries: [], sqlQueries: [] }), diagnostic: "Provide either a clarification or at least one query" },
    { name: "conflicting clarification", text: JSON.stringify({ clarification: "private-secret", queries: [queryInput], sqlQueries: [] }), diagnostic: "Provide either a clarification or at least one query" },
    { name: "lookup budget", text: JSON.stringify({ clarification: null, queries: Array(3).fill({ ...queryInput, stockSearches: ["a", "b"] }), sqlQueries: [] }), diagnostic: "queries: At most five stock lookups per plan" },
    ...[
      { name: "null", value: null },
      { name: "array", value: [] },
      { name: "string", value: JSON.stringify({ clarification: null, queries: [queryInput], sqlQueries: [] }) },
      { name: "number", value: 42 },
      { name: "boolean", value: false },
    ].map(({ name, value }) => ({ name: `root ${name}`, text: JSON.stringify(value), diagnostic: `plan: expected a JSON object, received ${name}` })),
    { name: "missing top-level fields", text: "{}", diagnostic: "clarification: missing field or incorrect type" },
    { name: "missing query fields", text: JSON.stringify({ clarification: null, queries: [{ mode: "ranking" }], sqlQueries: [] }), diagnostic: "queries.0.from: missing field or incorrect type" },
    { name: "wrapped plan", text: JSON.stringify({ "private-secret": { clarification: null, queries: [queryInput], sqlQueries: [] } }), diagnostic: "unexpected fields are not allowed" },
  ];
  it.each(cases)("repairs $name once with strict structured output and no tools", async ({ text, diagnostic }) => {
    await saveSettings(); interceptChat();
    script = [chunk({ content: text }, "stop") + "data: [DONE]\n\n"];
    const result = await research();
    expect(calls).toHaveLength(2);
    expect(calls[1].tools).toBeUndefined();
    expect(calls[1].response_format).toEqual(calls[0].response_format);
    const prompt = JSON.stringify(calls[1].messages);
    expect(prompt).toContain(diagnostic);
    expect(prompt).toContain("Regenerate a complete corrected plan");
    expect(prompt).not.toContain("private-secret");
    expect(result.message.content).toContain("00700 TENCENT");
    expect(result.tools?.find((item) => item.tool === "planResearch")?.summary).toContain("after 1 automatic plan repair");
    expect(pg.query.mock.calls.filter(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toHaveLength(1);
  });
  it.each(["hk", "hkex-db"])("repairs once in the %s workspace", async (useCaseId) => {
    await saveSettings(); interceptChat();
    script = [chunk({ content: "{}" }, "stop") + "data: [DONE]\n\n"];
    const result = await research(vi.fn(), useCaseId);
    expect(calls).toHaveLength(2);
    expect(result.message.content).toContain("## Results");
  });
  it.each(["hk", "hkex-db"])("blocks a non-object plan and failed repair in the %s workspace", async (useCaseId) => {
    await saveSettings(); interceptChat();
    plan = "private-secret";
    await expect(research(vi.fn(), useCaseId)).rejects.toThrow("plan: expected a JSON object, received string");
    expect(calls).toHaveLength(MAX_PLAN_REPAIRS + 1);
    expect(calls[1].tools).toBeUndefined();
    expect(JSON.stringify(calls[1].messages)).not.toContain("private-secret");
    expect(pg.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toBe(false);
  });
  it("never repairs or executes a valid-looking repair cut off at the token limit", async () => {
    await saveSettings(); interceptChat();
    script = [
      chunk({ content: "null" }, "stop") + "data: [DONE]\n\n",
      chunk({ content: JSON.stringify(plan) }, "length") + "data: [DONE]\n\n",
    ];
    await expect(research()).rejects.toThrow("4,096-token output limit");
    expect(calls).toHaveLength(2);
    expect(pg.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toBe(false);
  });
  it.each(cases)("reports safe specific details after exhausting repairs for $name and never runs final queries", async ({ text, diagnostic }) => {
    await saveSettings(); interceptChat();
    script = Array(MAX_PLAN_REPAIRS + 1).fill(chunk({ content: text }, "stop") + "data: [DONE]\n\n");
    await expect(research()).rejects.toThrow(diagnostic);
    expect(calls).toHaveLength(MAX_PLAN_REPAIRS + 1);
    expect(calls.slice(1).every((call) => call.tools === undefined)).toBe(true);
    expect(pg.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toBe(false);
  });
  it("does not echo unknown field names, values, or raw provider output into errors", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [], "fixture-api-key": "db-secret" };
    await expect(research()).rejects.toThrow("unexpected fields are not allowed");
    const response = await (await POST(request())).text();
    expect(response).toContain(`All ${MAX_PLAN_REPAIRS} automatic plan repairs failed`);
    expect(response).not.toMatch(/fixture-api-key|db-secret/);
  });
  it.each(["hk", "hkex-db"])("can succeed on the last permitted repair in the %s workspace without extra attempts", async (useCaseId) => {
    await saveSettings(); interceptChat();
    script = Array(MAX_PLAN_REPAIRS).fill(chunk({ content: "null" }, "stop") + "data: [DONE]\n\n");
    const onTools = vi.fn<(tools: ModelChatToolActivity[]) => void>();
    const result = await research(onTools, useCaseId);
    expect(calls).toHaveLength(4);
    expect(MAX_PLAN_REPAIRS).toBe(3);
    expect(calls.slice(1).every((call) => call.tools === undefined)).toBe(true);
    for (const call of calls) expect(call.response_format).toEqual(calls[0].response_format);
    expect(result.message.content).toContain("00700 TENCENT");
    expect(result.tools?.find((item) => item.tool === "planResearch")?.summary).toContain("after 3 automatic plan repairs");
    const summaries = onTools.mock.calls.flatMap(([tools]) => tools.filter((item) => item.tool === "planResearch").map((item) => item.summary));
    for (let repair = 1; repair <= MAX_PLAN_REPAIRS; repair++) {
      expect(summaries.some((summary) => summary.includes(`repair ${repair} of ${MAX_PLAN_REPAIRS}`))).toBe(true);
    }
    expect(pg.query.mock.calls.filter(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toHaveLength(1);
  });
  it("uses the latest safe validation failure for each correction and final error", async () => {
    await saveSettings(); interceptChat();
    script = [
      chunk({ content: "null" }, "stop"),
      chunk({ content: "[]" }, "stop"),
      chunk({ content: "{}" }, "stop"),
      chunk({ content: JSON.stringify({ clarification: null, queries: [], sqlQueries: [] }) }, "stop"),
    ].map((response) => response + "data: [DONE]\n\n");
    await expect(research()).rejects.toThrow(`Provide either a clarification or at least one query. All ${MAX_PLAN_REPAIRS} automatic plan repairs failed`);
    expect(calls).toHaveLength(4);
    expect(JSON.stringify(calls[1].messages)).toContain("received null");
    expect(JSON.stringify(calls[2].messages)).toContain("received array");
    expect(JSON.stringify(calls[3].messages)).toContain("clarification: missing field or incorrect type");
    expect(pg.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toBe(false);
  });
  it.each(["content_filter", "length"])("does not repair a %s finish", async (reason) => {
    await saveSettings(); interceptChat();
    finishReason = reason;
    await expect(research()).rejects.toThrow(reason === "length" ? "output limit" : "declined or filtered");
    expect(calls).toHaveLength(1);
  });
  it("does not repair an authentication failure", async () => {
    await saveSettings(); interceptChat();
    providerStatus = 401;
    await expect(research()).rejects.toThrow("HTTP 401");
    expect(calls).toHaveLength(1);
  });
  it("does not repair a broken stream without a normal finish", async () => {
    await saveSettings(); interceptChat();
    script = [chunk({ content: "{" }) + "data: [DONE]\n\n"];
    await expect(research()).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it.each(["cancellation", "timeout"])("keeps the existing %s signal during repair and never makes a third attempt", async (failure) => {
    await saveSettings();
    const controller = new AbortController();
    if (failure === "timeout") {
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === HKEX_SERVER_TIMEOUT_MS ? controller.signal : realTimeout(ms));
    }
    const realFetch = globalThis.fetch;
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (!String(url).endsWith("/chat/completions")) return realFetch(url, init);
      attempts++;
      if (attempts === 1) return new Response(chunk({ content: "{}" }, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
      return new Response(new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(chunk({ reasoning_content: "Correcting the plan." })));
          init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true });
          setTimeout(() => controller.abort(new DOMException(failure, failure === "timeout" ? "TimeoutError" : "AbortError")), 20);
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    });
    const body = await (await POST(new Request(request(), failure === "cancellation" ? { signal: controller.signal } : {}))).text();
    expect(body).toContain(failure === "timeout" ? `timed out after ${HKEX_SERVER_TIMEOUT_MS / 1000} seconds` : "cancelled");
    expect(body).not.toContain('"completed":true');
    expect(attempts).toBe(2);
    expect(pg.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.startsWith("WITH latest"))).toBe(false);
  });
});

describe("catalog-guided research", () => {
  const catalogRow = { id: "dataset:world-economy", kind: "dataset", relation: "public.insightful_dataset_rows", title: "World Economy", description: "GDP by country", rank: "0.6" };
  const described = {
    ...catalogRow, columns: [{ name: "gdp", type: "numeric", description: "GDP" }], sample_rows: [{ entity: "China", gdp: 18.5 }],
    query_notes: ["Read JSON keys"], example_queries: [], row_count: "100", coverage: { as_of: "2025-06" }, source: { name: "World Bank" },
  };
  const finalSql = "SELECT data->>'entity' AS entity, (data->>'gdp')::numeric AS gdp FROM public.insightful_dataset_rows WHERE dataset_id = 'world-economy' ORDER BY gdp DESC LIMIT 5";
  const entries = buildCatalogEntries({ sample_rows: [evidence], row_count: 2, coverage: { first_date: "2026-01-02", last_date: "2026-01-05" } })
    .map((entry) => entry.id === described.id ? described : entry);
  beforeEach(() => {
    const original = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (input: string | { text: string }, parameters?: unknown[]) => {
      const sql = typeof input === "string" ? input : input.text;
      if (sql.includes("to_regclass") && parameters?.[0] === "public.insightful_table_catalog") return { rows: [{ relation: "public.insightful_table_catalog" }] };
      if (sql.includes("SELECT id, kind, left(title")) return { rows: entries.filter((entry) => !parameters?.[0] || (parameters[0] as string[]).includes(entry.id))
        .map(({ id, kind, title }) => ({ id, kind, title })) };
      if (sql.includes("plainto_tsquery")) return { rows: [catalogRow] };
      if (sql.includes("sample_rows, query_notes")) return { rows: entries.filter((entry) => (parameters?.[0] as string[]).includes(entry.id)) };
      if (sql.includes("AS agent_query")) return { rows: [{ entity: "United States", gdp: "27.4" }, { entity: "China", gdp: "18.5" }] };
      return original(sql, parameters);
    });
  });

  it.each(["hk", "hkex-db"])("preloads descriptions and returns a direct plan in one request for %s", async (useCaseId) => {
    await saveSettings();
    const sql = useCaseId === "hk" ? "SELECT id FROM public.insightful_datasets ORDER BY id LIMIT 5" : finalSql;
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Stored data", sql }] };
    const text = await (await POST(request({ messages: [{ role: "user", content: "Show stored data" }], useCaseId }))).text();
    expect(text).toContain("## Stored data");
    expect(calls).toHaveLength(1);
    expect((calls[0].tools as { function: { name: string } }[]).map((item) => item.function.name)).toEqual(["runSql"]);
    const prompt = JSON.stringify(calls[0].messages);
    expect(prompt).toContain("Workspace tables");
    expect(prompt).toContain("Return the final plan straight away");
    expect(prompt).toContain("dataset:hk-indices");
    expect(prompt.includes("dataset:world-economy")).toBe(useCaseId === "hkex-db");
    expect(pg.query.mock.calls.some(([input]) => JSON.stringify(input).includes("plainto_tsquery"))).toBe(false);
  });

  it.each(["hk", "hkex-db"])("returns forbidden draft SQL as tool feedback then renders a validated plan for %s", async (useCaseId) => {
    await saveSettings(); interceptChat();
    const sql = useCaseId === "hk" ? "SELECT id FROM public.insightful_datasets ORDER BY id LIMIT 5" : finalSql;
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Stored data", sql }] };
    script = [
      toolCall("runSql", { sql: "SELECT settings FROM public.insightful_configuration" }),
    ];
    const result = await sendModelChat(undefined, [{ role: "user", content: "Show stored data" }], new AbortController().signal, vi.fn(), vi.fn(), { api: "/api/hkex/chat", useCaseId });
    expect(calls).toHaveLength(2);
    expect((calls[0].tools as { function: { name: string } }[]).map((item) => item.function.name)).toEqual(["runSql"]);
    expect(calls[1].tools).toBeUndefined();
    expect(JSON.stringify(calls[1].messages)).toContain("SQL rejected: table public.insightful_configuration is not in the catalog");
    expect(pg.query.mock.calls.some(([input]) => JSON.stringify(input).includes("insightful_configuration"))).toBe(false);
    expect(result.message.content).toContain("## Stored data");
    expect(result.message.content).toContain("| United States | 27.4 |");
    expect(result.message.content).toContain(useCaseId === "hk" ? "`public.insightful_datasets`" : "`public.insightful_dataset_rows`");
    const executed = result.tools?.find((item) => item.tool === "querySql");
    expect(executed?.status).toBe("complete");
    expect(result.tools?.some((item) => ["searchTables", "describeTable"].includes(item.tool))).toBe(false);
    expect(result.tools?.find((item) => item.tool === "runSql")?.status).toBe("error");
    expect(pg.query.mock.calls.filter(([input]) => typeof input === "string" && /^(INSERT|UPDATE|DELETE|CREATE)/.test(input))).toHaveLength(0);
  });

  it("preloads the HK Equities tables so it plans without searching, and scopes catalog reads and SQL", async () => {
    await saveSettings();
    const sql = "SELECT data->>'year' AS year FROM public.insightful_dataset_rows WHERE dataset_id = 'hk-indices'";
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Hang Seng", sql }] };
    script = [toolCall("runSql", { sql })];
    const response = await POST(request({ messages: [{ role: "user", content: "How has the Hang Seng moved?" }], useCaseId: "hk" }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("## Hang Seng");
    const scopeIds = ["hkex_short_selling", "insightful_datasets", "dataset:hk-indices", "dataset:hk-valuations", "dataset:hk-prices", "dataset:hk-financials"];
    const queries = pg.query.mock.calls.map(([input, parameters]) => ({ sql: typeof input === "string" ? input : input.text, parameters: parameters ?? input.values }));
    expect(queries.find((item) => item.sql.includes("SELECT id, kind, left(title"))?.parameters).toEqual([scopeIds]);
    expect(queries.find((item) => item.sql.includes("WHERE id = ANY($1::text[]) ORDER BY kind DESC"))?.parameters?.[0]).toEqual(expect.arrayContaining(scopeIds));
    expect(queries.some((item) => item.sql.includes("plainto_tsquery"))).toBe(false);
    expect(calls).toHaveLength(agent.MAX_AGENT_STEPS);
    expect((calls[0].tools as { function: { name: string } }[]).map((item) => item.function.name)).toEqual(["runSql"]);
    expect(calls.at(-1)!.tools).toBeUndefined();
    expect(JSON.stringify(calls[0].messages)).toContain("Workspace tables");
    expect(JSON.stringify(calls[0].messages)).toContain("Every field below is a key in the data jsonb column");
    expect(queries.find((item) => item.sql.includes("AS agent_query"))?.sql)
      .toContain("dataset_id = ANY(ARRAY['hk-indices', 'hk-valuations', 'hk-prices', 'hk-financials']::text[])");
    expect(JSON.stringify(calls[0].messages)).toContain("HK Equities Analyst");
  });

  it("keeps the HKEX workspace unscoped and rejects non-agent use cases before any provider or database call", async () => {
    await saveSettings();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "All", sql: "SELECT id FROM insightful_datasets" }] };
    script = [];
    await (await POST(request({ messages: [{ role: "user", content: "List datasets" }], useCaseId: "hkex-db" }))).text();
    expect(pg.query.mock.calls.find(([input]) => typeof input === "string" && input.includes("SELECT id, kind, left(title"))?.[1]).toEqual([null]);
    expect(pg.query.mock.calls.find(([input]) => JSON.stringify(input).includes("agent_query"))?.[0].text).not.toContain("ARRAY[");
    calls = []; pg.connect.mockClear();
    for (const useCaseId of ["macro", "missing", "__proto__"]) {
      const response = await POST(request({ messages: [{ role: "user", content: "GDP" }], useCaseId }));
      expect(response.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    expect(pg.connect).not.toHaveBeenCalled();
  });

  it("offers an explanation for HK Equities SQL answers, using the stored rows, workspace and table docs without re-querying", async () => {
    await saveSettings();
    const sql = "SELECT data->>'entity' AS entity FROM public.insightful_dataset_rows WHERE dataset_id = 'hk-valuations'";
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest HK stocks", sql }] };
    script = [];
    const text = await (await POST(request({ messages: [{ role: "user", content: "Top HK stocks by market cap" }], useCaseId: "hk" }))).text();
    const id = /"explanationId":"([0-9a-f-]{36})"/.exec(text)?.[1];
    expect(id).toBeDefined();
    pg.query.mockClear();
    const before = calls.length;
    explanation = true; script = undefined;
    interceptChat();
    const explained = await sendModelChat(undefined, [], new AbortController().signal, vi.fn(), undefined, { api: "/api/hkex/chat", explanationId: id });
    expect(calls).toHaveLength(before + 1);
    const prompt = JSON.stringify(calls.at(-1)!.messages);
    expect(prompt).toContain("United States");
    expect(prompt).toContain("Largest HK stocks");
    expect(prompt).toContain("HK Equities Analyst");
    expect(prompt).toContain("Every field below is a key in the data jsonb column");
    expect(prompt).toContain("Sample dataset registry");
    expect(prompt).not.toContain("Short turnover ratio is not short interest");
    expect(explained.message.content).toContain("## Explanation");
    expect(pg.query.mock.calls.some(([input]) => /insightful_(dataset|hkex|table_catalog)/.test(JSON.stringify(input)))).toBe(false);
  });

  it("withdraws tools on the final step so the loop always ends with a plan", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [toolCall("runSql", { sql: finalSql })];
    const result = await research();
    expect(calls).toHaveLength(agent.MAX_AGENT_STEPS);
    expect(calls.at(-1)!.tools).toBeUndefined();
    expect(result.message.content).toContain("## Largest economies");
  });

  it.each([1, MAX_PLAN_REPAIRS])("allows %s repairs after a draft check without re-executing tools", async (repairs) => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [
      toolCall("runSql", { sql: finalSql }),
      ...Array(repairs).fill(chunk({ content: '{"clarification":null,"queries":[],"sqlQueries":[]}' }, "stop") + "data: [DONE]\n\n"),
    ];
    const result = await research();
    expect(calls).toHaveLength(2 + repairs);
    expect(calls.slice(2).every((call) => call.tools === undefined)).toBe(true);
    expect(result.tools?.filter((item) => item.tool === "runSql")).toHaveLength(1);
    expect(result.message.content).toContain("## Largest economies");
    expect(result.tools?.find((item) => item.tool === "planResearch")?.summary).toContain(`${2 + repairs} model steps`);
  });

  it("executes at most one draft even when the model requests multiple SQL checks together", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [
      chunk({ tool_calls: [0, 1].map((index) => ({
        index, id: `call_${index}`, type: "function", function: { name: "runSql", arguments: JSON.stringify({ sql: finalSql }) },
      })) }) + chunk({}, "tool_calls") + "data: [DONE]\n\n",
    ];
    const result = await research();
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].messages)).toContain("Tool budget of 1 calls reached");
    expect(pg.query.mock.calls.filter(([input]) => JSON.stringify(input).includes("AS agent_query"))).toHaveLength(2);
    expect(result.tools?.filter((item) => item.tool === "runSql")).toHaveLength(1);
    expect(result.message.content).toContain("## Largest economies");
  });

  it("reports an invalid final SQL plan without executing it", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Secrets", sql: "SELECT * FROM insightful_configuration" }] };
    script = [];
    const result = await research();
    expect(result.message.content).toContain("This query could not be completed");
    expect(result.tools?.find((item) => item.tool === "querySql")?.status).toBe("error");
    expect(pg.query.mock.calls.some(([input]) => JSON.stringify(input).includes("agent_query"))).toBe(false);
  });

  const gdpChart = { result: 0, type: "bar", title: "GDP by economy", labelColumn: "entity", valueColumns: ["gdp"], seriesColumn: null };

  it("streams every SQL section before the chart agent answers, then adds a chart built from the returned rows", async () => {
    await saveSettings();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    chartChoice = { charts: [gdpChart] };
    let release!: () => void;
    chartGate = new Promise((resolve) => { release = resolve; });
    const response = await POST(request({ messages: [{ role: "user", content: "Largest economies" }] }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    while (!streamed.includes("| United States | 27.4 |")) {
      const { value, done } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value, { stream: true });
    }
    await vi.waitFor(() => expect(chartCalls).toHaveLength(1));
    expect(streamed).toContain("## Largest economies");
    expect(streamed).not.toContain("sqlChart");
    release();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
    }
    expect(rest).toContain('"sqlChart"');
    expect(rest).toContain('"type":"finish"');
    expect(calls).toHaveLength(1);
    expect(chartCalls[0].tools).toBeUndefined();
    const prompt = JSON.stringify(chartCalls[0].messages);
    expect(prompt).toContain("27.4");
    expect(prompt).toContain("untrusted data");
  });

  it("returns the validated chart and deterministic SQL insights through the client", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    chartChoice = { charts: [gdpChart] };
    const result = await research();
    const chart = result.tools?.find((item) => item.sqlChart)?.sqlChart;
    expect(chart).toMatchObject({ type: "bar", title: "GDP by economy", resultTitle: "Largest economies", labelColumn: "entity", valueLabel: "gdp", truncated: false });
    expect(chart?.points).toEqual([{ label: "United States", series: "gdp", value: 27.4 }, { label: "China", series: "gdp", value: 18.5 }]);
    expect(result.tools?.find((item) => item.tool === "chooseChart")).toMatchObject({ status: "complete", summary: "Added 1 chart after the answer." });
    const insights = result.tools?.find((item) => item.tool === "computeInsights")?.insights;
    expect(insights?.headline).toContain("United States has the highest gdp");
    expect(insights?.kpis).toEqual(expect.arrayContaining([{ label: "Returned rows", value: "2" }, { label: "Highest gdp", value: "27.4", hint: "United States" }]));
    const tools = result.tools!.map((item) => item.tool);
    expect(tools.indexOf("computeInsights")).toBeLessThan(tools.indexOf("chooseChart"));
  });

  it("adds no chart when the chart agent declines", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    const result = await research();
    expect(chartCalls).toHaveLength(1);
    expect(chartCalls[0]).toMatchObject({ max_tokens: 4096 });
    expect(result.tools?.some((item) => item.sqlChart)).toBe(false);
    expect(result.tools?.find((item) => item.tool === "chooseChart")?.summary).toBe("A chart would not add to these results.");
  });

  it("uses separate configured limits for planning, chart choice and explanation", async () => {
    await saveSettings(undefined, { planning: 6000, chart: 1500, explanation: 3000 }); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    const result = await research();
    expect(calls[0]).toMatchObject({ max_tokens: 6000 });
    expect(chartCalls[0]).toMatchObject({ max_tokens: 1500 });
    explanation = true;
    const id = result.tools!.find((item) => item.explanationId)!.explanationId!;
    await sendModelChat(undefined, [], new AbortController().signal, vi.fn(), undefined, { api: "/api/hkex/chat", explanationId: id });
    expect(calls.at(-1)).toMatchObject({ max_tokens: 3000 });
  });

  it("rejects a chart choice that does not fit the rows and keeps the answer", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    chartChoice = { charts: [{ ...gdpChart, valueColumns: ["entity"] }, { ...gdpChart, result: 2 }] };
    const result = await research();
    expect(result.tools?.some((item) => item.sqlChart)).toBe(false);
    expect(result.tools?.filter((item) => item.tool === "renderChart")).toEqual([expect.objectContaining({ status: "error" })]);
    expect(result.tools?.find((item) => item.tool === "chooseChart")?.summary).toBe("No valid chart could be built from these results.");
    expect(result.message.content).toContain("| United States | 27.4 |");
  });

  it("keeps the completed answer when chart selection fails", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Largest economies", sql: finalSql }] };
    script = [];
    chartStatus = 500;
    const result = await research();
    expect(result.message.content).toContain("| United States | 27.4 |");
    expect(result.tools?.find((item) => item.tool === "chooseChart")).toMatchObject({ status: "error", summary: "No chart was added; the results above are complete." });
    expect(JSON.stringify(result)).not.toContain("private upstream details");
  });

  it("makes no chart request for HKEX template answers or results that cannot be charted", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput }], sqlQueries: [] };
    await research();
    plan = { clarification: null, queries: [], sqlQueries: [{ title: "Dataset ids", sql: "SELECT id FROM public.insightful_datasets ORDER BY id LIMIT 5" }] };
    const original = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (input: string | { text: string }, parameters?: unknown[]) =>
      JSON.stringify(input).includes("AS agent_query") ? { rows: [{ id: "hk-indices" }, { id: "us-macro" }] } : original(input, parameters));
    const result = await research();
    expect(chartCalls).toHaveLength(0);
    expect(result.tools?.some((item) => item.tool === "chooseChart")).toBe(false);
    expect(result.tools?.some((item) => item.tool === "computeInsights")).toBe(false);
  });
});
