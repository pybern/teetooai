import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTIONS, type ApiSettings, type DatabaseSettings } from "@/lib/connections";
import { DefaultChatTransport, readUIMessageStream } from "ai";

const pg = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  options: vi.fn(),
}));
vi.mock("pg", () => ({
  Client: class {
    constructor(options: unknown) { pg.options(options); }
    connect = pg.connect;
    query = pg.query;
    end = pg.end;
    on = pg.on;
  },
}));

import {
  authorizeConfiguration, listApiModels, listApiModelCatalog, loadConnections, parseApi, parseApiEndpoint, parseDatabase,
  loadSavedApi, loadSavedDatabase, loadBootstrapConnections, publicConnections, saveConnection, testApi, testDatabase,
  configurationError,
} from "./connections";
import { GET, PUT } from "@/app/api/config/route";
import { POST } from "@/app/api/config/test/route";
import { POST as MODELS } from "@/app/api/config/models/route";
import { POST as CHAT } from "@/app/api/config/chat/route";

const adminToken = "test-administrator-token-with-32-characters";
const api = { baseUrl: "https://api.example.test/v1", model: "test-model", apiKey: "secret-api-key" };
const database: DatabaseSettings = {
  host: "db.example.test", port: 5432, database: "insights", username: "analyst",
  password: "secret-password", ssl: true, caCertificate: "",
};
let directory: string;
let server: Server;
let baseUrl: string;
let providerStatus = 200;
let providerBody = "";
let providerStream: string | undefined;
let streamingHandler: ((response: ServerResponse) => void) | undefined;
let received: { path?: string; method?: string; authorization?: string; body?: Record<string, unknown> };

function probeCompletion(feedback = "Connection confirmed.") {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ok: true, feedback }) } }] };
}

function configRequest(method = "GET", body?: unknown, token = adminToken) {
  return new Request("http://localhost/api/config", {
    method,
    headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "insightful-connections-"));
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received = { path: request.url, method: request.method, authorization: request.headers.authorization, body: body ? JSON.parse(body) : undefined };
    if (received.body?.stream && providerStatus === 200) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      if (streamingHandler) { streamingHandler(response); return; }
      if (providerStream !== undefined) { response.end(providerStream); return; }
      let reply: unknown;
      try { reply = JSON.parse(providerBody)?.choices?.[0]?.message?.content; } catch { reply = undefined; }
      if (typeof reply !== "string") { response.end(`data: ${providerBody}\n\n`); return; }
      response.end([
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""));
      return;
    }
    response.writeHead(providerStatus, { "Content-Type": "application/json" });
    response.end(providerBody);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

beforeEach(() => {
  for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_REASONING_EFFORT",
    "LLM_PLANNING_OUTPUT_TOKENS", "LLM_CHART_OUTPUT_TOKENS", "LLM_EXPLANATION_OUTPUT_TOKENS",
    "DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USERNAME", "DB_PASSWORD", "DB_SSL", "DB_CA_CERTIFICATE"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("CONFIG_ADMIN_TOKEN", adminToken);
  vi.stubEnv("CONNECTION_CONFIG_PATH", path.join(directory, `${crypto.randomUUID()}.json`));
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockResolvedValue({ rows: [{ database: "insights", user: "analyst", feedback: 1 }] });
  providerStatus = 200;
  providerBody = JSON.stringify({ choices: [{ message: { content: "Connection confirmed." } }] });
  providerStream = undefined;
  streamingHandler = undefined;
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

describe("configuration access and validation", () => {
  it("records readable error codes without logging exception messages or stack contents", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("secret-api-key\n    at secret-password"), { code: "EACCES" });
    const response = configurationError(error);
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith("Connection configuration operation failed", JSON.stringify({ name: "Error", code: "EACCES" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-");
    expect(await response.text()).not.toContain("secret-");
  });
  it("requires a sufficiently long server token", () => {
    vi.stubEnv("CONFIG_ADMIN_TOKEN", "");
    expect(() => authorizeConfiguration(configRequest())).toThrow("Set CONFIG_ADMIN_TOKEN");
  });
  it("rejects invalid tokens and cross-origin requests", () => {
    expect(() => authorizeConfiguration(configRequest("GET", undefined, "wrong"))).toThrow("Invalid administrator token");
    const request = configRequest();
    request.headers.set("Origin", "https://attacker.example");
    expect(() => authorizeConfiguration(request)).toThrow("Cross-origin");
    expect(() => authorizeConfiguration(configRequest())).not.toThrow();
  });
  it("uses the incoming host when Next.js normalizes the internal request URL", () => {
    const request = configRequest("PUT", {});
    request.headers.set("host", "127.0.0.1:3217");
    request.headers.set("origin", "http://127.0.0.1:3217");
    expect(() => authorizeConfiguration(request)).not.toThrow();
    request.headers.set("origin", "null");
    expect(() => authorizeConfiguration(request)).toThrow("Invalid request origin");
  });
  it("validates API URLs, model and credentials", () => {
    expect(parseApi({ ...api, baseUrl: `${api.baseUrl}/` }).baseUrl).toBe(api.baseUrl);
    for (const baseUrl of ["file:///etc/passwd", "https://user:pass@example.com", "https://api.test/?key=secret", "not a url"]) {
      expect(() => parseApi({ ...api, baseUrl })).toThrow();
    }
    expect(() => parseApi({ ...api, model: " " })).toThrow("model ID");
    expect(() => parseApi({ ...api, baseUrl: "http://api.example.test" })).toThrow("HTTPS");
    expect(() => parseApi({ ...api, apiKey: "key\nheader" })).toThrow("line breaks");
    expect(parseApi({ ...api, baseUrl: "http://localhost:8080/v1" })).toMatchObject({ model: "test-model" });
  });
  it("validates thinking effort and preserves provider-default compatibility", () => {
    for (const reasoningEffort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(parseApi({ ...api, reasoningEffort })).toMatchObject({ reasoningEffort });
    }
    for (const reasoningEffort of ["instant", "extreme", null, 1, {}, "high\n"]) {
      expect(() => parseApi({ ...api, reasoningEffort })).toThrow("thinking effort");
    }
    expect(parseApi({ ...api, reasoningEffort: "" })).toEqual(api);
    expect(parseApi(api)).toEqual(api);
  });
  it("validates per-step output-token limits and omits blanks so defaults apply", () => {
    expect(parseApi({ ...api, outputTokens: { planning: 8192, chart: 256, explanation: 32768 } }).outputTokens)
      .toEqual({ planning: 8192, chart: 256, explanation: 32768 });
    expect(parseApi({ ...api, outputTokens: { planning: 6000, chart: "", explanation: null } }).outputTokens).toEqual({ planning: 6000 });
    expect(parseApi({ ...api, outputTokens: {} })).toEqual(api);
    expect(parseApi({ ...api, outputTokens: null })).toEqual(api);
    for (const planning of [255, 32769, 1.5, "4096", -1]) {
      expect(() => parseApi({ ...api, outputTokens: { planning } })).toThrow("planning output-token limit must be a whole number from 256 to 32,768");
    }
    expect(() => parseApi({ ...api, outputTokens: { summary: 1000 } })).toThrow("only planning, chart and explanation");
    expect(() => parseApi({ ...api, outputTokens: 4096 })).toThrow();
  });
  it("accepts PostgreSQL hostnames, IPv4 and IPv6, and validates ports", () => {
    for (const host of ["db.example.test", "10.0.0.5", "::1"]) {
      expect(parseDatabase({ ...database, host }).host).toBe(host);
    }
    for (const host of ["postgres://db.test", "db.test:5432", "db.test/path", ""]) {
      expect(() => parseDatabase({ ...database, host })).toThrow("hostname");
    }
    for (const port of [0, 65536, 1.5, "5432", null]) {
      expect(() => parseDatabase({ ...database, port })).toThrow("Port");
    }
    expect(() => parseDatabase({ ...database, caCertificate: "not PEM" })).toThrow("PEM");
    expect(() => parseDatabase({ ...database, username: "" })).toThrow("required");
  });
});

describe("persistent settings", () => {
  it("persists thinking effort, returns it without secrets and can clear it to provider default", async () => {
    const result = await saveConnection("api", { ...api, reasoningEffort: "high" });
    expect(result.api).toMatchObject({ reasoningEffort: "high", hasApiKey: true });
    expect((await loadConnections()).api.reasoningEffort).toBe("high");
    expect(JSON.stringify(result)).not.toContain(api.apiKey);
    await saveConnection("api", { baseUrl: api.baseUrl, model: api.model, reasoningEffort: "" });
    expect((await loadConnections()).api.reasoningEffort).toBeUndefined();
    expect((await loadConnections()).api.apiKey).toBe(api.apiKey);
  });
  it("reports only environment-key availability without persisting or exposing the key", async () => {
    const environmentKey = "test-environment-gateway-key";
    vi.stubEnv("AI_GATEWAY_API_KEY", environmentKey);
    const saved = await saveConnection("api", { ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" });
    expect(saved.api).toMatchObject({ hasApiKey: true, environmentApiKeyAvailable: true });
    expect(JSON.stringify(saved)).not.toContain(environmentKey);
    expect((await loadConnections()).api.apiKey).toBe("configured-key");
    expect(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).not.toContain(environmentKey);
    expect(await (await GET(configRequest())).text()).not.toContain(environmentKey);
  });
  it("preloads known values in the form response without inventing credentials", async () => {
    const response = await GET(configRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      api: { baseUrl: "https://ai-gateway.vercel.sh/v1", model: "openai/gpt-4.1-mini", hasApiKey: false },
      database: {
        host: "", port: 5432, database: "", username: "", ssl: true,
        caCertificate: "", hasPassword: false,
      },
    });
  });
  it("uses known defaults for an absent section but preserves custom saved values", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database: { ...database, port: 6432 } }));
    expect(await loadConnections()).toEqual({
      api: DEFAULT_CONNECTIONS.api,
      database: { ...database, port: 6432 },
    });
    await saveConnection("api", api);
    const settings = await loadConnections();
    expect(settings.api).toEqual(api);
    expect(settings.database.port).toBe(6432);
  });
  it("returns defaults only for a missing file, not corrupt settings", async () => {
    expect(await loadConnections()).toEqual(DEFAULT_CONNECTIONS);
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, "invalid JSON");
    await expect(loadConnections()).rejects.toThrow();
  });
  it("persists sections, retains omitted secrets, clears explicit empty secrets and hides them", async () => {
    await saveConnection("api", api);
    expect((await loadConnections()).database).toEqual(DEFAULT_CONNECTIONS.database);
    await saveConnection("database", database);
    await saveConnection("api", { baseUrl: api.baseUrl, model: "updated-model" });
    const loaded = await loadConnections();
    expect(loaded.api.apiKey).toBe(api.apiKey);
    expect(loaded.database).toEqual(database);
    const publicSettings = publicConnections(loaded);
    expect(publicSettings.api.hasApiKey).toBe(true);
    expect(JSON.stringify(publicSettings)).not.toContain(api.apiKey);
    expect(JSON.stringify(publicSettings)).not.toContain(database.password);
    expect((await stat(process.env.CONNECTION_CONFIG_PATH!)).mode & 0o777).toBe(0o600);
    await saveConnection("api", { ...api, apiKey: "" });
    expect((await loadConnections()).api.apiKey).toBe("");
    await saveConnection("database", { ...database, password: "" });
    expect((await loadConnections()).database.password).toBe("");
    expect(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).not.toContain("secret-");
  });
  it("serializes simultaneous saves of different sections", async () => {
    await Promise.all([saveConnection("api", api), saveConnection("database", database)]);
    expect(await loadConnections()).toEqual({ api, database });
  });
});

describe("environment-first connection settings", () => {
  function setApiEnvironment() {
    vi.stubEnv("LLM_BASE_URL", api.baseUrl);
    vi.stubEnv("LLM_MODEL", "environment-model");
    vi.stubEnv("LLM_API_KEY", "environment-api-secret");
  }
  function setDatabaseEnvironment() {
    vi.stubEnv("DB_HOST", "environment-db.example.test");
    vi.stubEnv("DB_DATABASE", database.database);
    vi.stubEnv("DB_USERNAME", database.username);
    vi.stubEnv("DB_PASSWORD", "environment-db-secret");
  }

  it("loads both groups without touching corrupt legacy storage or PostgreSQL", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, "invalid JSON");
    setApiEnvironment();
    setDatabaseEnvironment();
    vi.stubEnv("LLM_REASONING_EFFORT", "high");
    vi.stubEnv("LLM_PLANNING_OUTPUT_TOKENS", "8192");
    vi.stubEnv("LLM_CHART_OUTPUT_TOKENS", "256");
    vi.stubEnv("LLM_EXPLANATION_OUTPUT_TOKENS", "32768");
    const loaded = await loadConnections();
    expect(loaded.api).toEqual({
      baseUrl: api.baseUrl, model: "environment-model", apiKey: "environment-api-secret",
      reasoningEffort: "high", outputTokens: { planning: 8192, chart: 256, explanation: 32768 },
    });
    expect(loaded.database).toEqual({
      ...database, host: "environment-db.example.test", password: "environment-db-secret",
    });
    expect(await loadSavedApi()).toEqual(loaded.api);
    expect(await loadSavedDatabase()).toEqual(loaded.database);
    expect(pg.connect).not.toHaveBeenCalled();
    const response = await GET(configRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("environment-api-secret");
    expect(JSON.stringify(publicConnections(loaded))).not.toContain("environment-db-secret");
  });

  it("uses env LLM with the saved database without querying the configuration table", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ api: "invalid", database }));
    setApiEnvironment();
    expect((await loadConnections()).database).toEqual(database);
    expect((await loadSavedApi()).model).toBe("environment-model");
    expect(pg.connect).not.toHaveBeenCalled();
  });

  it("uses env database for PostgreSQL API reads and saves without persisting env credentials", async () => {
    setDatabaseEnvironment();
    let stored = api;
    pg.query.mockImplementation(async (sql: string, parameters?: string[]) => {
      if (sql.includes("to_regclass")) return { rows: [{ relation: "insightful_configuration" }] };
      if (sql.startsWith("SELECT settings")) return { rows: [{ settings: stored }] };
      if (sql.startsWith("INSERT")) stored = JSON.parse(parameters![0]);
      return { rows: [] };
    });
    expect((await loadConnections()).api).toEqual(api);
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({ host: "environment-db.example.test", password: "environment-db-secret" }));
    await saveConnection("api", { ...api, model: "updated" });
    expect((await loadSavedApi()).model).toBe("updated");
    expect(await loadBootstrapConnections()).toEqual({});
  });

  it("keeps file-based API fallback and independent database loading", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ api }));
    setDatabaseEnvironment();
    expect((await loadConnections()).api).toEqual(api);
    expect((await loadSavedDatabase()).host).toBe("environment-db.example.test");
    await saveConnection("api", api);
    expect(await loadBootstrapConnections()).toEqual({ api });
    vi.stubEnv("LLM_BASE_URL", "invalid");
    expect((await loadSavedDatabase()).host).toBe("environment-db.example.test");
  });

  it("does not inherit secrets or optional settings from another saved endpoint", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ api: { ...api, reasoningEffort: "high" }, database }));
    setApiEnvironment();
    setDatabaseEnvironment();
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("DB_PASSWORD", "");
    expect((await loadSavedApi()).apiKey).toBe("");
    expect((await loadSavedApi()).reasoningEffort).toBeUndefined();
    expect((await loadSavedDatabase()).password).toBe("");
  });

  it("rejects saves of env-managed groups and leaves existing fallback data untouched", async () => {
    const content = JSON.stringify({ api, database });
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, content);
    setApiEnvironment();
    setDatabaseEnvironment();
    for (const kind of ["api", "database"] as const) {
      const response = await PUT(configRequest("PUT", { kind, settings: kind === "api" ? api : database }));
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("managed by environment");
    }
    expect(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).toBe(content);
    expect(pg.query).not.toHaveBeenCalled();
  });

  it("retains database saving when only the LLM group is environment-managed", async () => {
    setApiEnvironment();
    await saveConnection("database", database);
    expect(await loadBootstrapConnections()).toEqual({ database });
    expect(pg.query).not.toHaveBeenCalled();
  });

  it("preserves omitted env database passwords during connection tests", async () => {
    setDatabaseEnvironment();
    const settings = { ...database };
    delete settings.password;
    const response = await POST(configRequest("POST", { kind: "database", settings }));
    expect(response.status).toBe(200);
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({ password: "environment-db-secret" }));
  });

  it.each([
    ["LLM_BASE_URL", api.baseUrl, "LLM_MODEL"],
    ["LLM_API_KEY", "secret", "LLM_BASE_URL"],
    ["DB_HOST", database.host, "DB_DATABASE"],
    ["DB_PASSWORD", "secret", "DB_HOST"],
  ])("rejects incomplete env groups (%s) instead of using saved settings", async (key, value, message) => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ api, database }));
    vi.stubEnv(key, value);
    await expect(loadConnections()).rejects.toThrow(message);
  });

  it.each([
    ["LLM_BASE_URL", "not-a-url"], ["LLM_REASONING_EFFORT", "invalid"],
    ["LLM_PLANNING_OUTPUT_TOKENS", "255"], ["LLM_CHART_OUTPUT_TOKENS", "32769"],
    ["LLM_EXPLANATION_OUTPUT_TOKENS", "1.5"], ["DB_PORT", "0"],
    ["DB_PORT", "not-a-number"], ["DB_SSL", "yes"], ["DB_CA_CERTIFICATE", "invalid"],
  ])("validates environment values (%s)", async (key, value) => {
    setApiEnvironment();
    setDatabaseEnvironment();
    vi.stubEnv(key, value);
    await expect(loadConnections()).rejects.toThrow();
  });

  it("restores legacy settings when environment groups are removed", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ api, database }));
    setApiEnvironment();
    setDatabaseEnvironment();
    expect((await loadConnections()).api.model).toBe("environment-model");
    for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "DB_HOST", "DB_DATABASE", "DB_USERNAME", "DB_PASSWORD"]) {
      vi.stubEnv(key, "");
    }
    expect(await loadConnections()).toEqual({ api, database });
  });
});

describe("PostgreSQL API configuration storage", () => {
  let stored: ApiSettings | undefined;
  beforeEach(async () => {
    stored = { ...api, reasoningEffort: "high" };
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database, api: { ...api, model: "stale-file-model" } }));
    pg.query.mockImplementation(async (sql: string, parameters?: string[]) => {
      if (sql.includes("to_regclass")) return { rows: [{ relation: "insightful_configuration" }] };
      if (sql.startsWith("SELECT settings")) return { rows: stored ? [{ settings: stored }] : [] };
      if (sql.startsWith("INSERT INTO public.insightful_configuration")) {
        stored = JSON.parse(parameters![0]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
  });

  it("loads database settings instead of stale file values across all saved API readers", async () => {
    expect((await loadConnections()).api).toEqual(stored);
    expect(await loadSavedApi()).toEqual(stored);
    const response = await GET(configRequest());
    expect(await response.json()).toMatchObject({ api: { model: api.model, reasoningEffort: "high", hasApiKey: true } });
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({
      host: database.host, password: database.password, ssl: { rejectUnauthorized: true },
      application_name: "insightful-configuration",
    }));
  });

  it("saves parameterized settings, preserves omitted keys and removes legacy file secrets", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "environment-key-must-not-be-persisted");
    const result = await saveConnection("api", { baseUrl: api.baseUrl, model: "updated", reasoningEffort: "max" });
    expect(stored).toEqual({ ...api, model: "updated", reasoningEffort: "max" });
    expect(result.api).toMatchObject({ model: "updated", hasApiKey: true, reasoningEffort: "max" });
    expect(JSON.stringify(result)).not.toContain(api.apiKey);
    expect(await loadSavedApi()).toEqual(stored);
    const file = JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"));
    expect(file).toEqual({ database });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (kind)"), [JSON.stringify(stored)]);
    expect(pg.query).toHaveBeenCalledWith("COMMIT");
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"));
    await saveConnection("api", { ...api, apiKey: "", reasoningEffort: "" });
    expect(await loadSavedApi()).toEqual({ ...api, apiKey: "" });
  });

  it("does not resurrect legacy values when the initialized table has no API row", async () => {
    stored = undefined;
    expect((await loadConnections()).api).toEqual(DEFAULT_CONNECTIONS.api);
    await expect(loadSavedApi()).rejects.toThrow("Save your API settings");
    await saveConnection("api", { baseUrl: api.baseUrl, model: api.model });
    expect((await loadSavedApi()).apiKey).toBe("");
  });

  it("surfaces database failures without falling back to the file or reflecting secrets", async () => {
    pg.connect.mockRejectedValue(new Error(database.password));
    await expect(loadConnections()).rejects.toThrow("No file fallback was used");
    await expect(loadSavedApi()).rejects.toThrow("No file fallback was used");
    await expect(saveConnection("api", api)).rejects.toThrow("No file fallback was used");
    const response = await GET(configRequest());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(database.password);
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).api.model).toBe("stale-file-model");
  });

  it("rolls back failed writes and leaves the legacy file intact", async () => {
    const query = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string, parameters?: string[]) => {
      if (sql.startsWith("INSERT")) throw Object.assign(new Error(api.apiKey), { code: "42501" });
      return query(sql, parameters);
    });
    await expect(saveConnection("api", api)).rejects.toThrow("permissions");
    expect(pg.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(pg.end).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).api.model).toBe("stale-file-model");
  });

  it("can test a replacement database without first reading API storage from the old target", async () => {
    pg.query.mockResolvedValue({ rows: [{ database: "replacement", user: "analyst", feedback: 1 }] });
    const response = await POST(configRequest("POST", { kind: "database", settings: { ...database, host: "replacement.example.test" } }));
    expect(response.status).toBe(200);
    expect(pg.connect).toHaveBeenCalledOnce();
    expect(pg.options).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ host: "replacement.example.test" }));
    expect(pg.query).toHaveBeenCalledExactlyOnceWith('SELECT current_database() AS database, current_user AS "user", 1::int AS feedback');
  });

  it("updates bootstrap credentials even if the database cannot be reached and explicitly reports the outcome", async () => {
    pg.connect.mockRejectedValue(new Error("unreachable"));
    const changed = { ...database, host: "replacement.example.test", password: "new-password" };
    await expect(saveConnection("database", changed)).rejects.toThrow("was saved in the bootstrap file");
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).database).toEqual(changed);
    pg.connect.mockResolvedValue(undefined);
    expect((await loadConnections()).database).toEqual(changed);
  });
});

describe("Gateway environment-key precedence", () => {
  const environmentKey = "test-environment-gateway-key";
  beforeEach(() => { vi.stubEnv("AI_GATEWAY_API_KEY", environmentKey); });
  it("uses and redacts the environment key for connection feedback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(probeCompletion(`Received ${environmentKey}`)));
    const result = await testApi({ ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" });
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${environmentKey}`);
    expect(result.feedback).toBe("Received [redacted]");
  });
  it("uses the environment key for the model catalog and rejects reflected credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ data: [{ id: "alibaba/test-model" }] }));
    expect(await listApiModels({ ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" })).toEqual(["alibaba/test-model"]);
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${environmentKey}`);
    fetchSpy.mockResolvedValueOnce(Response.json({ data: [{ id: environmentKey }] }));
    await expect(listApiModels(DEFAULT_CONNECTIONS.api)).rejects.toThrow("reflected a credential");
  });
  it("does not fall back to the configured key when the environment key is rejected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Rejected", { status: 401 }));
    await expect(testApi({ ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" })).rejects.toThrow("AI_GATEWAY_API_KEY");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
  it.each(["", "   "])("uses the configured key when the environment variable is blank (%s)", async (value) => {
    vi.stubEnv("AI_GATEWAY_API_KEY", value);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(probeCompletion("Confirmed")));
    await testApi({ ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" });
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer configured-key");
  });
  it.each([
    "https://custom.example/v1", "https://ai-gateway.vercel.sh.attacker.example/v1",
    "https://ai-gateway.vercel.sh:8443/v1", "http://ai-gateway.vercel.sh/v1",
    "https://ai-gateway.vercel.sh/other-proxy/v1",
  ])("never sends the environment credential to another endpoint (%s)", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(probeCompletion("Confirmed")));
    await testApi({ ...api, baseUrl: url });
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${api.apiKey}`);
  });
  it("rejects malformed environment credentials before any network request", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "invalid\nkey");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(testApi(DEFAULT_CONNECTIONS.api)).rejects.toThrow("single-line");
    await expect(listApiModels(DEFAULT_CONNECTIONS.api)).rejects.toThrow("single-line");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("real HTTP model test", () => {
  beforeEach(() => { providerBody = JSON.stringify(probeCompletion()); });
  it("validates advertised effort before sending the connection test override", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: [{ id: api.model, reasoning_options: [{ type: "effort", values: ["low", "high"] }] }] }))
      .mockResolvedValueOnce(Response.json(probeCompletion("Confirmed")));
    expect((await testApi({ ...api, reasoningEffort: "high" })).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${api.baseUrl}/models`);
    expect(JSON.parse(fetchSpy.mock.calls[1][1]!.body as string)).toMatchObject({ reasoning_effort: "high" });
  });
  it("rejects unadvertised effort without sending a completion", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
      data: [{ id: api.model, reasoning_options: [{ type: "toggle" }, { type: "budget_tokens", min: 1024 }] }],
    }));
    await expect(testApi({ ...api, reasoningEffort: "high" })).rejects.toThrow("does not advertise");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
  it("verifies strict structured output and retains actual assistant feedback in one request", async () => {
    const result = await testApi({ ...api, baseUrl });
    expect(result).toMatchObject({ ok: true, feedback: "Connection confirmed." });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(received).toMatchObject({
      path: "/v1/chat/completions",
      authorization: `Bearer ${api.apiKey}`,
      body: {
        model: api.model, stream: false, max_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "researchConnectionProbe", strict: true,
            schema: { type: "object", required: ["ok", "feedback"], additionalProperties: false },
          },
        },
      },
    });
    expect(result.message).toContain("strict JSON-schema output verified");
  });
  it.each(["{}", '{"choices":[]}', '{"choices":[{"message":{"content":"  "}}]}', "null", '{"choices":"private upstream details"}'])("does not pass HTTP 200 with an incomplete completion: %s", async (body) => {
    providerBody = body;
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("incomplete OpenAI-compatible completion");
  });
  it.each([null, "", "   "])("rejects normally finished responses without feedback (%s)", async (content) => {
    providerBody = JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] });
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("no non-empty assistant feedback");
  });
  it.each([
    "Connection confirmed.", '{"ok":true,', "null", "[]",
    JSON.stringify(JSON.stringify({ ok: true, feedback: "Confirmed" })),
    JSON.stringify({ ok: false, feedback: "Confirmed" }),
    JSON.stringify({ ok: true, feedback: " " }),
    JSON.stringify({ ok: true, feedback: "Confirmed", "private-secret": "hidden" }),
  ])("rejects ignored or violated schemas without reflecting output (%s)", async (content) => {
    providerBody = JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] });
    const error = await testApi({ ...api, baseUrl }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/JSON-schema|strict JSON schema/);
    expect(String(error)).not.toMatch(/private-secret|hidden/);
  });
  it.each(["length", "content_filter", "tool_calls"])("does not accept valid JSON after a %s finish", async (finishReason) => {
    const completion = probeCompletion();
    completion.choices[0].finish_reason = finishReason;
    providerBody = JSON.stringify(completion);
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow(finishReason === "length" ? "output limit" : "did not finish");
  });
  it("rejects refusals even when the content matches the schema", async () => {
    providerBody = JSON.stringify({ choices: [{ ...probeCompletion().choices[0], message: {
      ...probeCompletion().choices[0].message, refusal: "private upstream details",
    } }] });
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("did not finish");
  });
  it("uses the configured planning limit for the compatibility probe", async () => {
    await testApi({ ...api, baseUrl, outputTokens: { planning: 6000 } });
    expect(received.body?.max_tokens).toBe(6000);
  });
  it("rejects invalid JSON and oversized responses", async () => {
    providerBody = "<html>not a completion</html>";
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("invalid JSON");
    providerBody = JSON.stringify({ choices: [{ message: { content: "x".repeat(70000) } }] });
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("64 KB");
  });
  it("reports HTTP failures without reflecting provider secrets", async () => {
    providerStatus = 401;
    providerBody = api.apiKey;
    await expect(testApi({ ...api, baseUrl })).rejects.toThrow("HTTP 401");
  });
  it.each([503, 502, 504, 429])("distinguishes provider availability/quota errors from authentication (HTTP %s)", async (status) => {
    providerStatus = status;
    providerBody = api.apiKey;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const error = await testApi({ ...api, baseUrl }).catch((error: unknown) => error);
    expect(error).toMatchObject({ status, message: expect.stringContaining(`HTTP ${status}`) });
    expect(error).toMatchObject({ message: expect.stringContaining("No automatic retry") });
    expect(String(error)).not.toContain(api.apiKey);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
  it("redacts credentials reflected in feedback", async () => {
    providerBody = JSON.stringify(probeCompletion(`Received ${api.apiKey}`));
    expect((await testApi({ ...api, baseUrl })).feedback).toBe("Received [redacted]");
  });
  it("reports timeout and connection errors explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
    await expect(testApi(api)).rejects.toThrow("timed out");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("secret upstream details"));
    await expect(testApi(api)).rejects.toThrow("Could not reach");
  });
});

describe("PostgreSQL connection test", () => {
  it("uses host/port credentials and verified TLS, runs only SELECT, and closes", async () => {
    expect(await testDatabase(database)).toMatchObject({ ok: true, feedback: "Connected to insights as analyst. SELECT returned 1." });
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({
      host: database.host, port: 5432, password: database.password, ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 15000, query_timeout: 15000,
    }));
    expect(pg.query).toHaveBeenCalledExactlyOnceWith('SELECT current_database() AS database, current_user AS "user", 1::int AS feedback');
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("supports explicitly disabled TLS and custom CA", async () => {
    await testDatabase({ ...database, ssl: false });
    expect(pg.options).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: false }));
    await testDatabase({ ...database, caCertificate: "-----BEGIN CERTIFICATE-----\ntest" });
    expect(pg.options).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----\ntest" } }));
  });
  it("closes after authentication errors and exposes no raw password", async () => {
    pg.connect.mockRejectedValueOnce(Object.assign(new Error(database.password), { code: "28P01" }));
    await expect(testDatabase(database)).rejects.toThrow("Authentication failed");
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("does not pass without expected query feedback and closes after query failure", async () => {
    pg.query.mockResolvedValueOnce({ rows: [] });
    await expect(testDatabase(database)).rejects.toThrow("no expected query feedback");
    pg.query.mockRejectedValueOnce(new Error("query error"));
    await expect(testDatabase(database)).rejects.toThrow("PostgreSQL test failed");
    expect(pg.end).toHaveBeenCalledTimes(2);
  });
});

describe("live model catalog", () => {
  it("reads per-model effort values without inventing support from names, toggles or budgets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ data: [
      { id: "qwen-reasoner", reasoning_options: [{ type: "effort", values: ["none", "low", "high", "max", "high", "unknown", api.apiKey] }] },
      { id: "budget-only", reasoning_options: [{ type: "toggle" }, { type: "budget_tokens", min: 1024 }] },
      { id: "plain-model" },
      { id: "malformed-options", reasoning_options: [{ type: "effort", values: "high" }, null, { type: "effort", values: [5, {}] }] },
    ] }));
    const catalog = await listApiModelCatalog(api);
    expect(catalog).toEqual({
      models: ["budget-only", "malformed-options", "plain-model", "qwen-reasoner"],
      reasoningEfforts: {
        "qwen-reasoner": ["none", "low", "high", "max"], "budget-only": [], "plain-model": [], "malformed-options": [],
      },
    });
    expect(JSON.stringify(catalog)).not.toContain(api.apiKey);
  });
  it("validates endpoint settings without requiring a model", () => {
    expect(parseApiEndpoint({ baseUrl: api.baseUrl, apiKey: api.apiKey })).toEqual({ baseUrl: api.baseUrl, apiKey: api.apiKey });
    expect(() => parseApi({ baseUrl: api.baseUrl, apiKey: api.apiKey })).toThrow("Model");
    expect(() => parseApiEndpoint({ baseUrl: "file:///tmp/models" })).toThrow("HTTP");
  });
  it("includes every model, including Qwen and non-chat models, without a shortlist or 64 KB truncation", async () => {
    const ids = [
      "alibaba/qwen3-coder", "alibaba/qwen3.8-max", "alibaba/qwen3-embedding-8b",
      "openai/gpt-4.1-mini", "google/gemini-3.8-flash", "openai/gpt-image-1",
      ...Array.from({ length: 500 }, (_, i) => `provider/model-${i}`),
    ];
    providerBody = JSON.stringify({ data: ids.map((id) => ({ id, description: "metadata ".repeat(40) })) });
    expect(Buffer.byteLength(providerBody)).toBeGreaterThan(65536);
    const models = await listApiModels({ baseUrl, apiKey: api.apiKey });
    expect(models).toHaveLength(ids.length);
    expect(new Set(models)).toEqual(new Set(ids));
    expect(models).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(received).toMatchObject({ method: "GET", path: "/v1/models", authorization: `Bearer ${api.apiKey}` });
  });
  it("deduplicates IDs without stripping provider prefixes", async () => {
    providerBody = JSON.stringify({ data: [{ id: "alibaba/qwen3-coder" }, { id: "alibaba/qwen3-coder" }, { id: "qwen3-coder" }] });
    expect(await listApiModels({ baseUrl })).toEqual(["alibaba/qwen3-coder", "qwen3-coder"]);
    expect(received.authorization).toBeUndefined();
  });
  it.each([
    ["not JSON", "invalid JSON"],
    ['{"models":[]}', "data array"],
    ['{"data":[]}', "empty model catalog"],
    ['{"data":[{"name":"qwen"}]}', "invalid model ID"],
    ['{"data":[{"id":""}]}', "invalid model ID"],
  ])("reports malformed catalogs explicitly: %s", async (body, error) => {
    providerBody = body;
    await expect(listApiModels({ baseUrl })).rejects.toThrow(error);
  });
  it("handles provider failures, oversized catalogs and reflected credentials", async () => {
    providerStatus = 403;
    providerBody = api.apiKey;
    await expect(listApiModels({ baseUrl, apiKey: api.apiKey })).rejects.toThrow("HTTP 403");
    providerStatus = 200;
    providerBody = JSON.stringify({ data: [{ id: api.apiKey }] });
    await expect(listApiModels({ baseUrl, apiKey: api.apiKey })).rejects.toThrow("reflected a credential");
    providerBody = JSON.stringify({ data: [{ id: "large", description: "x".repeat(2 * 1024 * 1024) }] });
    await expect(listApiModels({ baseUrl })).rejects.toThrow("2048 KB");
  });
  it("handles timeouts and network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
    await expect(listApiModels(api)).rejects.toThrow("timed out");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    await expect(listApiModels(api)).rejects.toThrow("Could not load");
  });
  it("protects model listing and uses saved credentials without exposing or saving them", async () => {
    expect((await MODELS(configRequest("POST", { settings: api }, "wrong"))).status).toBe(401);
    await saveConnection("api", api);
    providerBody = JSON.stringify({ data: [{ id: "alibaba/qwen3-coder" }, { id: "openai/gpt-4.1-mini" }] });
    const response = await MODELS(configRequest("POST", { settings: { baseUrl } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      models: ["alibaba/qwen3-coder", "openai/gpt-4.1-mini"],
      reasoningEfforts: { "alibaba/qwen3-coder": [], "openai/gpt-4.1-mini": [] },
    });
    expect(received.authorization).toBe(`Bearer ${api.apiKey}`);
    expect((await loadConnections()).api).toEqual(api);
    expect((await MODELS(configRequest("POST", { settings: { baseUrl: "bad" } }))).status).toBe(400);
  });
});

describe("configuration routes", () => {
  it("protects read, save and test endpoints", async () => {
    expect((await GET(configRequest("GET", undefined, "wrong"))).status).toBe(401);
    expect((await PUT(configRequest("PUT", { kind: "api", settings: api }, "wrong"))).status).toBe(401);
    expect((await POST(configRequest("POST", { kind: "database", settings: database }, "wrong"))).status).toBe(401);
    expect(pg.connect).not.toHaveBeenCalled();
  });

  describe("saved-model chat route", () => {
    async function readReply(response: Response, onText?: (text: string) => void, onReasoning?: (text: string) => void) {
      const transport = new DefaultChatTransport({ fetch: async () => response });
      const stream = await transport.sendMessages({
        trigger: "submit-message", chatId: "test", messageId: undefined, messages: [], abortSignal: undefined,
      });
      let final;
      for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
        final = message;
        onText?.(message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""));
        onReasoning?.(message.parts.filter((part) => part.type === "reasoning").map((part) => part.text).join(""));
      }
      return {
        message: { role: final?.role, content: final?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") },
        reasoning: final?.parts.filter((part) => part.type === "reasoning").map((part) => part.text).join(""),
        ...(final?.metadata ?? {}),
      };
    }
    const messages = [{ role: "user", content: "Hello, saved model" }];
    function event(delta: Record<string, string>, finish = false) {
      return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish ? "stop" : null }] })}\n\n${finish ? "data: [DONE]\n\n" : ""}`;
    }
    it("sends saved thinking effort through the SDK as reasoning_effort, ignoring unsaved overrides", async () => {
      await saveConnection("api", { ...api, reasoningEffort: "max" });
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json({ data: [{ id: api.model, reasoning_options: [{ type: "effort", values: ["low", "max"] }] }] }))
        .mockResolvedValueOnce(new Response(event({ reasoning_content: "Thinking" }) + event({ content: "Final" }, true), {
          headers: { "Content-Type": "text/event-stream" },
        }));
      const result = await readReply(await CHAT(configRequest("POST", { messages, reasoningEffort: "low", settings: { reasoningEffort: "low" } })));
      expect(result).toMatchObject({ reasoning: "Thinking", message: { content: "Final" } });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchSpy.mock.calls[1][1]!.body as string)).toMatchObject({ reasoning_effort: "max", stream: true });
    });
    it("returns a preflight error for an effort no longer advertised without generating", async () => {
      await saveConnection("api", { ...api, reasoningEffort: "high" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
        data: [{ id: api.model, reasoning_options: [{ type: "effort", values: ["low"] }] }],
      }));
      const response = await CHAT(configRequest("POST", { messages }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("does not advertise") });
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
    it("reports unavailable capability metadata rather than generating with an unverified override", async () => {
      await saveConnection("api", { ...api, reasoningEffort: "high" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
      const response = await CHAT(configRequest("POST", { messages }));
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("Model catalog returned HTTP 503") });
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
    it("uses the Gateway environment key for saved-model streaming and redacts thinking and reply", async () => {
      const environmentKey = "test-environment-gateway-key";
      vi.stubEnv("AI_GATEWAY_API_KEY", environmentKey);
      await saveConnection("api", { ...DEFAULT_CONNECTIONS.api, apiKey: "configured-key" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        event({ reasoning_content: environmentKey.slice(0, 10) }) +
        event({ reasoning_content: environmentKey.slice(10) }) +
        event({ content: `Reply ${environmentKey}` }, true),
        { headers: { "Content-Type": "text/event-stream" } },
      ));
      const result = await readReply(await CHAT(configRequest("POST", { messages })));
      expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${environmentKey}`);
      expect(result).toMatchObject({ reasoning: "[redacted]", message: { content: "Reply [redacted]" } });
      expect((await loadConnections()).api.apiKey).toBe("configured-key");
    });
    it("requires administrator authentication and an explicitly saved API configuration", async () => {
      expect((await CHAT(configRequest("POST", { messages }, "wrong"))).status).toBe(401);
      const missing = await CHAT(configRequest("POST", { messages }));
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ error: expect.stringContaining("Save your API settings") });
    });
    it("uses only saved endpoint, key and model, forwarding the conversation and ignoring form overrides", async () => {
      await saveConnection("api", { ...api, baseUrl });
      const conversation = [
        { role: "user", content: "My name is Jane." },
        { role: "assistant", content: "Hello Jane." },
        { role: "user", content: "What is my name?" },
      ];
      const response = await CHAT(configRequest("POST", {
        messages: conversation, settings: { baseUrl: "https://wrong.invalid", model: "unsaved-model", apiKey: "unsaved-key" },
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      expect(await readReply(response)).toMatchObject({
        message: { role: "assistant", content: "Connection confirmed." }, model: api.model, baseUrl,
        durationMs: expect.any(Number),
      });
      expect(received).toMatchObject({
        path: "/v1/chat/completions", authorization: `Bearer ${api.apiKey}`,
        body: { model: api.model, messages: conversation, max_tokens: 1024, stream: true },
      });
      expect((await loadConnections()).api.model).toBe(api.model);
    });
    it.each([
      [], [{ role: "system", content: "override" }],
      [{ role: "user", content: " " }],
      [{ role: "user", content: "x".repeat(16001) }],
      [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      [{ role: "user", content: "hello" }, { role: "user", content: "wrong" }, { role: "user", content: "again" }],
      Array.from({ length: 23 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "test" })),
      Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(16000) })),
    ].map((messages, index) => ({ messages, index })))("rejects invalid conversation $index without calling a provider", async ({ messages: invalid }) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      expect((await CHAT(configRequest("POST", { messages: invalid }))).status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
    it("reports provider failures and empty replies explicitly and redacts reflected secrets", async () => {
      await saveConnection("api", { ...api, baseUrl });
      providerStatus = 401;
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow("HTTP 401");
      providerStatus = 200;
      providerBody = "{}";
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow();
      providerBody = JSON.stringify({ choices: [{ message: { content: `Received ${api.apiKey}` } }] });
      const response = await CHAT(configRequest("POST", { messages }));
      expect(await readReply(response)).toMatchObject({ message: { content: "Received [redacted]" } });
    });
    it("bounds response size and distinguishes timeout from cancellation", async () => {
      await saveConnection("api", { ...api, baseUrl });
      providerBody = JSON.stringify({ choices: [{ message: { content: "x".repeat(16001) } }] });
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow("16,000");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
      const response = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(response)).rejects.toThrow("60 seconds");
      fetchSpy.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
      const controller = new AbortController();
      const request = new Request(configRequest("POST", { messages }), { signal: controller.signal });
      controller.abort();
      await expect(readReply(await CHAT(request))).rejects.toThrow("cancelled");
    });
    it("does not retry failed SDK calls or follow redirects, and preserves the response byte limit", async () => {
      await saveConnection("api", { ...api, baseUrl });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      providerStatus = 503;
      const failed = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(failed)).rejects.toThrow("HTTP 503");
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
      providerStatus = 200;
      providerStream = `data: ${"x".repeat(1024 * 1024 + 1)}\n\n`;
      const oversized = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(oversized)).rejects.toThrow("1024 KB");
    });
    it("explains Gateway 503s without blaming credentials, reflecting upstream bodies or retrying", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "private-environment-gateway-key");
      await saveConnection("api", { ...api, baseUrl: "https://ai-gateway.vercel.sh/v1" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        "private-environment-gateway-key: upstream internal details", { status: 503 },
      ));
      const response = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(response)).rejects.toThrow("AI Gateway or its upstream model provider is unavailable");
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
    it("supports saved endpoints without a key and rejects blank SDK replies without exposing raw errors", async () => {
      await saveConnection("api", { ...api, baseUrl, apiKey: "" });
      providerBody = JSON.stringify({ choices: [{ message: { role: "assistant", content: " " }, finish_reason: "stop" }] });
      const blank = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(blank)).rejects.toThrow("no non-empty assistant feedback");
      expect(received.authorization).toBeUndefined();
      providerBody = api.apiKey;
      const malformed = await CHAT(configRequest("POST", { messages }));
      await expect(readReply(malformed)).rejects.not.toThrow(api.apiKey);
    });
    it("redacts a credential even when it spans multiple provider chunks", async () => {
      await saveConnection("api", { ...api, baseUrl });
      const chunks = ["Received ", api.apiKey.slice(0, 4), api.apiKey.slice(4, 9), api.apiKey.slice(9), " confirmed."];
      providerStream = chunks.map((content) => `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`).join("") + `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      const response = await CHAT(configRequest("POST", { messages }));
      const text = await response.text();
      expect(text).not.toContain(api.apiKey);
      expect(text).not.toContain(api.apiKey.slice(0, 4));
      expect(text).toContain("[redacted]");
    });
    it("delivers feedback before the upstream finishes, without buffering the full response", async () => {
      await saveConnection("api", { ...api, baseUrl });
      let finish!: () => void;
      streamingHandler = (response) => {
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "First 你好" }, finish_reason: null }] })}\n\n`);
        finish = () => response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: " final" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      };
      let first!: () => void;
      const firstText = new Promise<void>((resolve) => { first = resolve; });
      let completed = false;
      const reply = readReply(await CHAT(configRequest("POST", { messages })), (text) => {
        if (text === "First 你好") first();
      }).then((result) => { completed = true; return result; });
      try {
        await firstText;
        expect(completed).toBe(false);
      } finally { finish(); }
      expect(await reply).toMatchObject({ message: { content: "First 你好 final" }, completed: true });
    });
    it.each(["reasoning_content", "reasoning"])("streams provider %s before the final answer", async (field) => {
      await saveConnection("api", { ...api, baseUrl });
      let finish!: () => void;
      streamingHandler = (response) => {
        response.write(event({ [field]: "Thinking 你好" }));
        finish = () => response.end(event({ content: "Final answer" }, true));
      };
      let first!: () => void;
      const firstReasoning = new Promise<void>((resolve) => { first = resolve; });
      let completed = false;
      let answer = "";
      const reply = readReply(await CHAT(configRequest("POST", { messages })), (text) => { answer = text; }, (text) => {
        if (text === "Thinking 你好") first();
      }).then((result) => { completed = true; return result; });
      try {
        await firstReasoning;
        expect(completed).toBe(false);
        expect(answer).toBe("");
      } finally { finish(); }
      expect(await reply).toMatchObject({ reasoning: "Thinking 你好", message: { content: "Final answer" }, completed: true });
    });
    it("redacts credentials across reasoning chunks without mixing reasoning and answer buffers", async () => {
      await saveConnection("api", { ...api, baseUrl });
      providerStream = [
        event({ reasoning_content: `Consider ${api.apiKey.slice(0, 5)}` }),
        event({ reasoning_content: `${api.apiKey.slice(5)} carefully.` }),
        event({ content: `Reply ${api.apiKey.slice(0, 8)}` }),
        event({ content: `${api.apiKey.slice(8)}.` }, true),
      ].join("");
      const result = await readReply(await CHAT(configRequest("POST", { messages })));
      expect(result).toMatchObject({
        reasoning: "Consider [redacted] carefully.", message: { content: "Reply [redacted]." },
      });
      expect(JSON.stringify(result)).not.toContain(api.apiKey);
    });
    it("bounds thinking output and requires a nonempty final answer", async () => {
      await saveConnection("api", { ...api, baseUrl });
      providerStream = event({ reasoning_content: "x".repeat(16001) }) + event({ content: "Answer" }, true);
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow("thinking exceeded the 16,000");
      providerStream = event({ reasoning_content: "Only thinking" }, true);
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow("no non-empty assistant feedback");
    });
    it("cancels the upstream provider when the response consumer disconnects", async () => {
      await saveConnection("api", { ...api, baseUrl });
      let disconnected!: () => void;
      const closed = new Promise<void>((resolve) => { disconnected = resolve; });
      streamingHandler = (response) => {
        response.on("close", disconnected);
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "First" }, finish_reason: null }] })}\n\n`);
      };
      const response = await CHAT(configRequest("POST", { messages }));
      const reader = response.body!.getReader();
      let text = "";
      while (!text.includes("First")) {
        const { done, value } = await reader.read();
        if (done) throw new Error("No incremental feedback received");
        text += new TextDecoder().decode(value);
      }
      await reader.cancel();
      await closed;
    });
    it("rejects incomplete upstream streams instead of committing a partial reply", async () => {
      await saveConnection("api", { ...api, baseUrl });
      providerStream = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Partial reply" }, finish_reason: null }] })}\n\n`;
      await expect(readReply(await CHAT(configRequest("POST", { messages })))).rejects.toThrow("before completion");
    });
  });
  it("returns redacted settings after save and after reload", async () => {
    const response = await PUT(configRequest("PUT", { kind: "api", settings: api }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ api: { hasApiKey: true } });
    const loaded = await GET(configRequest());
    expect(loaded.headers.get("Cache-Control")).toBe("no-store");
    expect(await loaded.text()).not.toContain(api.apiKey);
  });
  it("tests unsaved settings without persisting them", async () => {
    providerBody = JSON.stringify(probeCompletion());
    const result = await POST(configRequest("POST", { kind: "api", settings: { ...api, baseUrl } }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, feedback: "Connection confirmed." });
    expect(await loadConnections()).toEqual(DEFAULT_CONNECTIONS);
  });
  it("reports schema-incompatible unsaved settings as a failed configuration test", async () => {
    providerBody = JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "private upstream details" } }] });
    const result = await POST(configRequest("POST", { kind: "api", settings: { ...api, baseUrl } }));
    expect(result.status).toBe(502);
    const body = await result.text();
    expect(body).toContain("JSON-schema structured output");
    expect(body).not.toContain("private upstream details");
    expect(await loadConnections()).toEqual(DEFAULT_CONNECTIONS);
  });
  it("can reuse a saved secret when testing and rejects invalid input", async () => {
    await saveConnection("database", database);
    const withoutPassword = { ...database, password: undefined };
    const response = await POST(configRequest("POST", { kind: "database", settings: withoutPassword }));
    expect(response.status).toBe(200);
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({ password: database.password }));
    expect((await PUT(configRequest("PUT", { kind: "unknown" }))).status).toBe(400);
    expect((await POST(configRequest("POST", null))).status).toBe(400);
    expect((await PUT(new Request("http://localhost/api/config", {
      method: "PUT", headers: { Authorization: `Bearer ${adminToken}` }, body: "{",
    }))).status).toBe(400);
  });
});
