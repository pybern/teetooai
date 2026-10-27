import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendModelChat } from "@/lib/model-chat-stream";
import { DEFAULT_CONNECTIONS, type ModelChatToolActivity, type ReasoningEffort } from "@/lib/connections";
import { loadConnections, saveConnection } from "./connections";
import { hkexPlanSchema } from "./hkex-agent";
import { POST } from "@/app/api/hkex/chat/route";
import { POST as INSIGHT } from "@/app/api/insight/route";
import { GET as CONFIG } from "@/app/api/config/route";
import { POST as INITIALIZE } from "@/app/api/config/database/initialize/route";
import * as access from "./hkex-access";
import * as agent from "./hkex-agent";

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
    calls.push(JSON.parse(raw));
    if (providerStatus !== 200) { response.writeHead(providerStatus); response.end("private upstream details"); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(chunk({ reasoning_content: "Select the supported query." }) +
      chunk({ content: explanation ? "## Explanation\n\nTENCENT: HKD 12345.67, based on retrieved evidence." : JSON.stringify(plan) }, finishReason) + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No provider fixture address");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
beforeEach(() => {
  calls = []; providerStatus = 200; explanation = false;
  supportedEfforts = ["none", "minimal", "low", "medium", "high"];
  finishReason = "stop";
  plan = { clarification: null, queries: [{ ...queryInput }] };
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
async function saveSettings(reasoningEffort?: ReasoningEffort) {
  await saveConnection("database", { ...DEFAULT_CONNECTIONS.database, host: "fixture-db", database: "fixture", username: "reader", password: "db-secret" });
  await saveConnection("api", { baseUrl, model: "fixture-model", apiKey: "fixture-api-key", reasoningEffort });
}
function interceptChat() {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => url === "/api/hkex/chat"
    ? POST(new Request("http://localhost/api/hkex/chat", init)) : realFetch(url, init));
}
async function research(onTools = vi.fn()) {
  return sendModelChat(undefined, [{ role: "user", content: "Chart HKD short selling." }], new AbortController().signal, vi.fn(), vi.fn(), { api: "/api/hkex/chat", onTools });
}
describe("single-call HKEX research", () => {
  it("plans and renders exact factual results in exactly one provider request", async () => {
    await saveSettings(); interceptChat();
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "fixture-model", stream: true, max_tokens: 4096, reasoning_effort: "low" });
    expect(calls[0].tools).toBeUndefined();
    expect(calls[0].response_format).toMatchObject({ type: "json_schema" });
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
  it("reports the 120-second server deadline as a timeout, not user cancellation", async () => {
    await saveSettings();
    const deadline = new AbortController();
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 120000 ? deadline.signal : realTimeout(ms));
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
    await expect(research()).rejects.toThrow("timed out after 120 seconds");
    expect(timeout).toHaveBeenCalledWith(120000);
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it.each(["auto", "HKEXHorizontalBarChart"])("renders a %s catalog chart without a chart or narrative model call", async (chart) => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, chart }] };
    const onTools = vi.fn<(tools: ModelChatToolActivity[]) => void>();
    const result = await research(onTools);
    expect(calls).toHaveLength(1);
    expect(result.tools?.find((item) => item.chart)?.chart?.elements.chart.props.points[0].value).toBe("12345.67");
    expect(result.tools?.find((item) => item.chart)?.chart?.elements.chart.type).toBe(chart === "auto" ? "HKEXBarChart" : chart);
  });
  it("reports an incompatible chart while retaining valid query results", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, chart: "HKEXAreaChart" }] };
    const result = await research();
    expect(calls).toHaveLength(1);
    expect(result.message.content).toContain("This chart isn't available");
    expect(result.message.content).toContain("12345.67");
    expect(result.tools?.some((item) => item.chart)).toBe(false);
  });
  it("resolves stock names server-side before querying, without additional model calls", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, stockSearches: ["Tencent"] }] };
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
    ] };
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
    expect(pg.query).toHaveBeenCalledTimes(20);
    expect(pg.end).toHaveBeenCalledTimes(7);
  });
  it("validates every resolved query before starting any parallel data reads", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [
      { ...queryInput },
      { ...queryInput, from: "2026-02-30", to: "2026-03-02" },
    ] };
    await expect(research()).rejects.toThrow("Invalid HKEX filters");
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
  });
  it("asks for clarification on ambiguous stock names rather than looping or guessing", async () => {
    await saveSettings(); interceptChat();
    plan = { clarification: null, queries: [{ ...queryInput, stockSearches: ["bank"] }] };
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
    plan = { clarification: "Prices require an additional dataset.", queries: [] };
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
    for (const badPlan of [{ sql: "DELETE FROM private" }, { clarification: null, queries: [{ ...queryInput, from: "2026-02-30", to: "2026-03-02" }] }]) {
      plan = badPlan;
      const body = await (await POST(request())).text();
      expect(body).not.toContain('"completed":true');
      expect(pg.query.mock.calls.some(([sql]) => sql.startsWith("WITH latest"))).toBe(false);
    }
  });
  it("validates plan-level query/lookup limits", () => {
    expect(hkexPlanSchema.safeParse({ clarification: null, queries: Array(4).fill(queryInput) }).success).toBe(false);
    expect(hkexPlanSchema.safeParse({ clarification: null, queries: Array(3).fill({ ...queryInput, stockSearches: ["a", "b"] }) }).success).toBe(false);
    expect(hkexPlanSchema.safeParse({ clarification: "Ambiguous", queries: [queryInput] }).success).toBe(false);
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
      .rejects.toThrow("Research generation reached its 4,096-token output limit");
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
