import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTIONS } from "@/lib/connections";
import { buildHkexQuery, HkexDatabase, HKEX_READ_LIMIT, validateHkexQuery, type HkexQuery } from "./hkex-database";
import { buildCatalogEntries, catalogIdsForScope } from "./table-catalog";

const pg = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    connect = pg.connect; query = pg.query; end = pg.end; on = pg.on;
  },
}));

const filters: HkexQuery = {
  mode: "ranking", from: null, to: null, stockCodes: [], currency: "HKD", board: null,
  metric: "short_selling_value", limit: 10,
};
const settings = { ...DEFAULT_CONNECTIONS.database, host: "test-db", database: "test", username: "reader", password: "db-secret" };

beforeEach(() => {
  vi.clearAllMocks();
  pg.connect.mockResolvedValue(undefined);
  pg.end.mockResolvedValue(undefined);
  pg.query.mockResolvedValue({ rows: [] });
});

describe("bounded HKEX queries", () => {
  it("builds fixed SQL with parameterized filters, exact numeric strings and weighted ratios", () => {
    const result = buildHkexQuery({ ...filters, from: "2026-01-01", to: "2026-02-01", stockCodes: ["00700"], metric: "short_turnover_percent" });
    expect(result.parameters).toEqual(["2026-01-01", "2026-02-01", "HKD", null, ["00700"], 11]);
    expect(result.sql).toContain("sum(short_selling_value) / nullif(sum(total_turnover), 0)");
    expect(result.sql).toContain("AND trading_currency = $3");
    expect(result.sql).toContain("stock_code = ANY($5::text[])");
    expect(result.sql).toContain("WHERE ($1::date IS NULL OR $2::date IS NULL) AND trading_currency = $3");
    expect(result.sql).not.toContain("00700");
    expect(result.sql).not.toContain("avg(");
  });
  it("defaults trends to all stored days (up to 366) and rankings to the latest stored day", () => {
    const trend = buildHkexQuery({ ...filters, mode: "market-trend" }).sql;
    expect(trend).toContain("GREATEST(first_stored, COALESCE($2::date, day) - 365)");
    expect(trend).not.toMatch(/- 29\b/);
    expect(buildHkexQuery(filters).sql).toContain("COALESCE($1::date, COALESCE($2::date, day)) AS first_day");
  });
  it.each([
    { ...filters, stockCodes: ["700"] }, { ...filters, stockCodes: ["00700'); DROP TABLE x;--"] },
    { ...filters, currency: "ANY" }, { ...filters, board: "other" }, { ...filters, limit: 101 },
    { ...filters, limit: 0 }, { ...filters, metric: "pg_sleep(10)" }, { ...filters, mode: "sql" },
    { ...filters, from: "2026-02-30", to: "2026-03-01" },
    { ...filters, from: "2026-03-01", to: "2026-02-01" },
    { ...filters, from: "2024-01-01", to: "2026-01-01" },
    { ...filters, from: "2026-01-01" }, { ...filters, mode: "stock-trend" },
  ])("rejects unsafe or invalid filters without a database call: %j", (query) => {
    expect(() => validateHkexQuery(query as HkexQuery)).toThrow();
    expect(pg.connect).not.toHaveBeenCalled();
  });
  it("reports truncation explicitly and brackets every query in a read-only transaction", async () => {
    pg.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("WITH latest") ? Array.from({ length: 11 }, (_, i) => ({ stock_code: String(i).padStart(5, "0") })) : [] }));
    const result = await new HkexDatabase(settings, new AbortController().signal).query(filters);
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(pg.query.mock.calls[0][0]).toBe("BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL search_path = public");
    expect(pg.query).toHaveBeenCalledTimes(3);
    expect(pg.query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("normalizes short stock codes without interpreting SQL or wildcards", async () => {
    const database = new HkexDatabase(settings, new AbortController().signal);
    await database.findStocks("700");
    expect(pg.query.mock.calls[1][1]).toEqual(["00700", "%700%"]);
    await database.findStocks("50%_\\");
    expect(pg.query.mock.calls[4][1]).toEqual([null, "%50\\%\\_\\\\%"]);
  });
  it("fails explicitly for missing tables, empty coverage and oversized evidence", async () => {
    const database = new HkexDatabase(settings, new AbortController().signal);
    await expect(database.inspect()).rejects.toThrow("missing or not accessible");
    pg.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("information_schema.columns") ? [{ column_name: "stock_code" }] : [] }));
    await expect(database.inspect()).rejects.toThrow("existing HKEX table is empty");
    pg.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("WITH latest") ? [{ stock_name: "x".repeat(32001) }] : [] }));
    await expect(database.query(filters)).rejects.toThrow("32,000");
  });
  it.each([null, ["hk-indices", "hk-valuations", "hk-prices", "hk-financials"]])("preloads all permitted real catalog descriptions for scope %j", async (datasetIds) => {
    const scope = { datasetIds };
    const ids = catalogIdsForScope(scope);
    const entries = buildCatalogEntries({ sample_rows: [], row_count: 2, coverage: {} })
      .filter((entry) => !ids || ids.includes(entry.id))
      .map((entry) => ({
        id: entry.id, relation: entry.relation, title: entry.title, description: entry.description,
        columns: entry.columns, sample_rows: entry.sample_rows, query_notes: entry.query_notes,
        example_queries: entry.example_queries, row_count: String(entry.row_count),
        coverage: entry.coverage, source: entry.source,
      }));
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "stock_code" }] };
      if (sql.includes("count(DISTINCT stock_code)")) return { rows: [{ first_date: "2026-01-02", last_date: "2026-01-05" }] };
      if (sql.includes("to_regclass")) return { rows: [{ relation: "public.insightful_table_catalog" }] };
      if (sql.includes("SELECT id, kind, left(title")) return { rows: entries.map(({ id, title }) => ({ id, title, kind: "dataset" })) };
      if (sql.includes("sample_rows, query_notes")) return { rows: entries };
      return { rows: [] };
    });
    const metadata = await new HkexDatabase(settings, new AbortController().signal, scope).inspect();
    expect(metadata.tables).toEqual(entries);
    expect(metadata.tables?.some((entry) => entry.id === "dataset:world-economy")).toBe(datasetIds === null);
    expect(pg.query.mock.calls.find(([sql]) => sql.includes("WHERE id = ANY($1::text[]) ORDER BY kind DESC"))?.[1])
      .toEqual([entries.map((entry) => entry.id)]);
    if (datasetIds === null) expect(JSON.stringify(metadata).length).toBeGreaterThan(32000);
  });
  it.each(["incomplete", "oversized"])("rejects %s preloaded catalog descriptions explicitly", async (failure) => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "stock_code" }] };
      if (sql.includes("count(DISTINCT stock_code)")) return { rows: [{ first_date: "2026-01-02" }] };
      if (sql.includes("to_regclass")) return { rows: [{ relation: "public.insightful_table_catalog" }] };
      if (sql.includes("SELECT id, kind, left(title")) return { rows: [{ id: "hkex_short_selling", title: "HKEX", kind: "table" }] };
      if (sql.includes("sample_rows, query_notes")) return { rows: failure === "incomplete" ? [] : [{ id: "hkex_short_selling", description: "x".repeat(128001) }] };
      return { rows: [] };
    });
    await expect(new HkexDatabase(settings, new AbortController().signal).inspect())
      .rejects.toThrow(failure === "incomplete" ? "descriptions are incomplete" : "128,000");
    expect(pg.end).toHaveBeenCalledOnce();
  });
  it("sanitizes database failures, releases connections and bounds the number of reads", async () => {
    const database = new HkexDatabase(settings, new AbortController().signal);
    pg.query.mockRejectedValueOnce(Object.assign(new Error("password db-secret"), { code: "42501" }));
    await expect(database.query(filters)).rejects.toThrow("SELECT access");
    expect(pg.end).toHaveBeenCalledOnce();
    pg.query.mockResolvedValue({ rows: [] });
    for (let i = 0; i < HKEX_READ_LIMIT - 1; i++) await database.query(filters);
    await expect(database.query(filters)).rejects.toThrow(`${HKEX_READ_LIMIT}-read limit`);
    expect(pg.connect).toHaveBeenCalledTimes(HKEX_READ_LIMIT);
  });
  it("propagates cancellation and closes the active client on stream abort", async () => {
    const controller = new AbortController();
    const database = new HkexDatabase(settings, new AbortController().signal);
    database.attachSignal(controller.signal);
    pg.query.mockImplementation(async () => {
      controller.abort();
      throw new Error("Connection terminated");
    });
    await expect(database.query(filters)).rejects.toThrow("cancelled");
    expect(pg.end).toHaveBeenCalled();
  });
});
