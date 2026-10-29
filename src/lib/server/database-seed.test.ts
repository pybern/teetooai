import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DATASETS } from "@/lib/data";
import { HKEX_COLUMNS, initializeSavedDatabase, loadHkexSeed, parseHkexSeed } from "./database-seed";
import { POST } from "@/app/api/config/database/initialize/route";
import { HKEX_COVERAGE } from "@/lib/hkex-coverage";
import { USE_CASE_BY_ID } from "@/lib/usecases";

const pg = vi.hoisted(() => ({
  connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn(), options: vi.fn(),
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

const token = "database-seed-test-admin-token-with-32-characters";
const database = { host: "db.example.test", port: 6432, database: "insights", username: "seed_user", password: "never-reflect-this-password", ssl: true, caCertificate: "" };
const api = { baseUrl: "https://api.example.test/v1", model: "saved-model", apiKey: "private-api-key", reasoningEffort: "high" };
const sample = "Main Board,2026-10-20,00001,\"NAME, WITH \"\"QUOTES\"\"\",123,456.78,999,1234.56,HKD,https://www.hkex.com.hk/report";
let directory: string;

function request(body: unknown, adminToken = token) {
  return new Request("http://localhost/api/config/database/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "insightful-seed-")); });
beforeEach(async () => {
  vi.stubEnv("CONFIG_ADMIN_TOKEN", token);
  vi.stubEnv("CONNECTION_CONFIG_PATH", path.join(directory, `${crypto.randomUUID()}.json`));
  await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database }));
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockImplementation(async (sql: string, parameters?: string[]) => {
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("to_regclass")) return { rows: [{ relation: null }] };
    if (sql.startsWith("INSERT")) return { rowCount: JSON.parse(parameters![0]).length, rows: [] };
    return { rows: [] };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("HKEX seed validation", () => {
  it("parses quoted CSV and preserves stock codes and exact decimal strings", () => {
    const records = parseHkexSeed(`${HKEX_COLUMNS.join(",")}\r\n${sample}\r\n`);
    expect(records[0]).toMatchObject({
      stock_code: "00001", stock_name: 'NAME, WITH "QUOTES"',
      short_selling_value: "456.78", total_turnover: "1234.56",
    });
  });
  it.each([
    { source: "wrong,columns\n1,2", reason: "columns" },
    { source: HKEX_COLUMNS.join(","), reason: "empty" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample}\n${sample}`, reason: "duplicate" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace("2026-10-20", "2026-02-30")}`, reason: "invalid date" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace(",00001,", ",1,")}`, reason: "invalid date" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace(",123,", ",-1,")}`, reason: "share counts" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace(",456.78,", ",NaN,")}`, reason: "monetary values" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace(",HKD,", ",EUR,")}`, reason: "currency" },
    { source: `${HKEX_COLUMNS.join(",")}\n${sample.replace(",123,", ",9223372036854775808,")}`, reason: "share counts" },
  ])("rejects bad source data: $reason", ({ source, reason }) => {
    expect(() => parseHkexSeed(source)).toThrow(reason);
  });
  it("loads all bundled HKEX records and validates coverage, currencies and leading zeros", async () => {
    const { rows, summary } = await loadHkexSeed();
    expect(rows).toHaveLength(34077);
    expect(summary).toEqual({ records: 34077, from: "2026-08-24", to: "2026-10-20", currencies: ["CNY", "HKD", "USD"] });
    expect(rows[0].stock_code).toBe("00001");
    expect(rows.filter((row) => row.board === "GEM")).toHaveLength(118);
    expect(rows.filter((row) => row.trading_currency === "USD")).toHaveLength(352);
  });
  it("keeps the displayed use-case coverage in sync with the bundled seed", async () => {
    const { rows, summary } = await loadHkexSeed();
    expect(HKEX_COVERAGE).toEqual({ from: summary.from, to: summary.to, tradingDays: new Set(rows.map((row) => row.trading_date)).size });
    const text = JSON.stringify(USE_CASE_BY_ID["hkex-db"]);
    expect(text).toContain("24 Aug 2026");
    expect(text).toContain("20 Oct 2026");
    expect(text).not.toMatch(/30 (available )?calendar days|last 30/);
  });
});

describe("transactional database initialization", () => {
  it("requires authentication, confirmation, and a saved database", async () => {
    expect((await POST(request({ confirm: true }, "wrong"))).status).toBe(401);
    expect((await POST(request({ confirm: false }))).status).toBe(400);
    expect(pg.connect).not.toHaveBeenCalled();
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, "{}");
    const response = await POST(request({ confirm: true }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Save your database settings") });
  });
  it("uses only saved connection settings, verified TLS and parameterized batched inserts", async () => {
    const response = await POST(request({ confirm: true, settings: { host: "wrong.invalid" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = await response.json();
    expect(result).toMatchObject({
      ok: true, database: database.database, host: database.host, port: database.port,
      tables: [
        { name: "public.insightful_datasets", status: "created", insertedRows: DATASETS.length },
        { name: "public.insightful_dataset_rows", status: "created", insertedRows: DATASETS.reduce((sum, ds) => sum + ds.rows.length, 0) },
        { name: "public.insightful_hkex_short_selling", status: "created", insertedRows: 34077 },
        { name: "public.insightful_table_catalog", status: "created", insertedRows: DATASETS.length + 2 },
        { name: "public.insightful_configuration", status: "created", insertedRows: 0 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(database.password);
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({
      host: database.host, port: database.port, password: database.password,
      ssl: { rejectUnauthorized: true }, query_timeout: 60000,
    }));
    const inserts = pg.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"));
    expect(inserts.length).toBeGreaterThan(34);
    for (const [sql, args] of inserts) {
      expect(sql).toContain("$1::jsonb");
      expect(JSON.parse(args[0]).length).toBeLessThanOrEqual(1000);
    }
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("skips existing data relations without querying, updating or reseeding their rows, and refreshes the catalog", async () => {
    pg.query.mockImplementation(async (sql: string, params?: string[]) => ({
      rows: sql.includes("pg_try_advisory") ? [{ locked: true }] : sql.includes("to_regclass") ? [{ relation: params![0] }] : [],
      rowCount: sql.startsWith("INSERT INTO public.insightful_table_catalog") ? JSON.parse(params![0]).length : 0,
    }));
    const result = await initializeSavedDatabase();
    expect(result.tables).toHaveLength(5);
    expect(result.tables.filter((table) => table.name !== "public.insightful_table_catalog")
      .every((table) => table.status === "skipped" && table.insertedRows === 0)).toBe(true);
    expect(result.tables[3]).toEqual({ name: "public.insightful_table_catalog", status: "seeded", insertedRows: DATASETS.length + 2 });
    expect(pg.query.mock.calls.some(([sql]) => !sql.includes("insightful_table_catalog") && /CREATE TABLE|INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
    const catalog = pg.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO public.insightful_table_catalog"));
    const entries = JSON.parse(catalog![1][0]) as { id: string; relation: string; search_text: string }[];
    expect(entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(["hkex_short_selling", "insightful_datasets", ...DATASETS.map((ds) => `dataset:${ds.id}`)]));
    expect(entries.some((entry) => entry.relation.includes("configuration") || entry.search_text.includes("insightful_configuration"))).toBe(false);
    expect(pg.query.mock.calls.some(([sql]) => sql.includes("DELETE FROM public.insightful_table_catalog WHERE id LIKE 'dataset:%'"))).toBe(true);
    expect(pg.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
  it("migrates legacy API settings and removes them from the file only after commit", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database, api }));
    const result = await initializeSavedDatabase();
    expect(result.tables.at(-1)).toEqual({ name: "public.insightful_configuration", status: "created", insertedRows: 1 });
    const migration = pg.query.mock.calls.find(([sql]) => sql.includes("ON CONFLICT (kind) DO NOTHING"));
    expect(migration).toBeDefined();
    expect(JSON.parse(migration![1][0])).toEqual([{ kind: "api", settings: api }]);
    expect(pg.query).toHaveBeenCalledWith("REVOKE ALL ON TABLE public.insightful_configuration FROM PUBLIC");
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"))).toEqual({ database });
    expect(JSON.stringify(result)).not.toContain(api.apiKey);
  });
  it.each([0, 1])("imports only missing configuration without overwriting existing values (inserted: %i)", async (insertedRows) => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database, api }));
    pg.query.mockImplementation(async (sql: string, params?: string[]) => ({
      rows: sql.includes("pg_try_advisory") ? [{ locked: true }] : sql.includes("to_regclass") ? [{ relation: params![0] }] : [],
      rowCount: sql.startsWith("INSERT") ? insertedRows : 0,
    }));
    const result = await initializeSavedDatabase();
    expect(result.tables.at(-1)).toEqual({
      name: "public.insightful_configuration", status: insertedRows ? "seeded" : "skipped", insertedRows,
    });
    const migration = pg.query.mock.calls.find(([sql]) => sql.includes("ON CONFLICT (kind) DO NOTHING"));
    expect(migration).toBeDefined();
    expect(JSON.parse(migration![1][0])).toEqual([{ kind: "api", settings: api }]);
    expect(pg.query.mock.calls.some(([sql]) => !sql.includes("insightful_table_catalog") && /CREATE TABLE|UPDATE|DELETE/.test(sql))).toBe(false);
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"))).toEqual({ database });
  });
  it("preserves legacy API settings when migration fails and rolls back seed changes", async () => {
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ database, api }));
    const query = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string, params?: string[]) => {
      if (sql.includes("INSERT INTO public.insightful_configuration")) throw Object.assign(new Error(api.apiKey), { code: "42501" });
      return query(sql, params);
    });
    await expect(initializeSavedDatabase()).rejects.toThrow("Initialization did not commit");
    expect(pg.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"))).toEqual({ database, api });
  });
  it("rejects concurrent initialization without blocking", async () => {
    pg.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory") ? [{ locked: false }] : [],
    }));
    const response = await POST(request({ confirm: true }));
    expect(response.status).toBe(409);
    expect(pg.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("rejects an overlapping initializer in this process instead of queueing a second import", async () => {
    let release!: () => void;
    pg.connect.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const first = initializeSavedDatabase();
    await expect(initializeSavedDatabase()).rejects.toThrow("already running on this server");
    release();
    expect((await first).ok).toBe(true);
  });
  it("rolls back all earlier table creations if an insert fails and redacts raw database errors", async () => {
    const base = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string, parameters?: string[]) => {
      if (sql.includes("INSERT INTO public.insightful_dataset_rows")) {
        throw Object.assign(new Error(database.password), { code: "23503" });
      }
      return base(sql, parameters);
    });
    const response = await POST(request({ confirm: true }));
    expect(response.status).toBe(502);
    const error = await response.text();
    expect(error).toContain("existing dataset catalog");
    expect(error).not.toContain(database.password);
    expect(pg.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(pg.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
  });
  it("checks inserted row counts before committing", async () => {
    const base = pg.query.getMockImplementation()!;
    pg.query.mockImplementation(async (sql: string, parameters?: string[]) =>
      sql.startsWith("INSERT") ? { rows: [], rowCount: 0 } : base(sql, parameters));
    await expect(initializeSavedDatabase()).rejects.toThrow("count");
    expect(pg.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("reports uncertain rollback instead of claiming successful cleanup", async () => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("Disconnected");
      if (sql.includes("pg_try_advisory")) return { rows: [{ locked: false }] };
      return { rows: [] };
    });
    await expect(initializeSavedDatabase()).rejects.toThrow("rollback could not be confirmed");
  });
  it("does not connect if the request was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(initializeSavedDatabase(controller.signal)).rejects.toThrow("cancelled");
    expect(pg.connect).not.toHaveBeenCalled();
    expect(pg.end).toHaveBeenCalledOnce();
  });
});
