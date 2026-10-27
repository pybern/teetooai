import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HkexDatabase, type HkexQuery } from "./hkex-database";

const connectionString = process.env.TEST_POSTGRES_URL;
const filters: HkexQuery = {
  mode: "ranking", from: null, to: null, stockCodes: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 10,
};

describe.skipIf(!connectionString)("HKEX research against isolated PostgreSQL", () => {
  let admin: Client;
  let client: Client;
  let database: HkexDatabase;
  const name = `hkex_agenttest_${randomBytes(8).toString("hex")}`;

  beforeAll(async () => {
    admin = new Client({ connectionString });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString!);
    url.pathname = `/${name}`;
    client = new Client({ connectionString: url.href });
    await client.connect();
    await client.query(`CREATE TABLE public.insightful_hkex_short_selling (
      board text NOT NULL, trading_date date NOT NULL, stock_code text NOT NULL,
      stock_name text NOT NULL, short_selling_shares bigint NOT NULL,
      short_selling_value numeric NOT NULL, total_traded_shares bigint NOT NULL,
      total_turnover numeric NOT NULL, trading_currency text NOT NULL, source_url text NOT NULL,
      PRIMARY KEY (trading_date, stock_code))`);
    const records = [
      ["2026-01-02", "00700", "TENCENT", "9007199254740993", "20.000001", "100", "HKD"],
      ["2026-01-05", "00700", "TENCENT", "20", "19.999999", "900", "HKD"],
      ["2026-01-05", "00005", "HSBC", "100", "100", "1000", "HKD"],
      ["2026-01-05", "89999", "CNY COUNTER", "999", "99999999999999.123456", "100000000000000", "CNY"],
      ["2026-01-05", "09999", "ZERO TURNOVER", "5", "5", "0", "HKD"],
      ["2026-01-05", "01234", "PERCENT% LTD", "1", "1", "10", "HKD"],
    ];
    for (const row of records) {
      await client.query(`INSERT INTO public.insightful_hkex_short_selling
        (board, trading_date, stock_code, stock_name, short_selling_shares, short_selling_value, total_traded_shares, total_turnover, trading_currency, source_url)
        VALUES ('Main Board', $1, $2, $3, $4, $5, 100, $6, $7, 'https://www.hkex.com.hk/example')`, row);
    }
    database = new HkexDatabase({
      host: url.hostname, port: Number(url.port || 5432), database: name,
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false, caCertificate: "",
    }, new AbortController().signal);
  });
  afterAll(async () => {
    await client?.end();
    if (admin) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it("inspects actual columns and per-currency stored coverage", async () => {
    const metadata = await database.inspect();
    expect(metadata.columns).toHaveLength(10);
    expect(metadata.coverage).toContainEqual(expect.objectContaining({
      trading_currency: "HKD", first_date: "2026-01-02", last_date: "2026-01-05", rows: "5", stocks: "4",
    }));
  });
  it("uses the latest stored date and never mixes currencies in a ranking", async () => {
    const result = await database.query(filters);
    expect(result.rows[0]).toMatchObject({ stock_code: "00005", short_selling_value: "100", trading_currency: "HKD" });
    expect(result.rows.every((row) => row.first_date === "2026-01-05" && row.trading_currency === "HKD")).toBe(true);
    expect(result.rows.find((row) => row.stock_code === "09999")?.short_turnover_percent).toBeNull();
    expect(result.truncated).toBe(false);
  });
  it("computes weighted turnover ratios and preserves exact bigint and decimal values", async () => {
    const result = await database.query({
      ...filters, stockCodes: ["00700"], from: "2026-01-02", to: "2026-01-05", metric: "short_turnover_percent",
    });
    expect(result.rows[0]).toMatchObject({
      stock_code: "00700", short_selling_value: "40.000000", short_selling_shares: "9007199254741013", short_turnover_percent: "4.0000",
    });
    const cny = await database.query({ ...filters, currency: "CNY" });
    expect(cny.rows[0].short_selling_value).toBe("99999999999999.123456");
  });
  it("returns ordered stock and market trends with explicit truncation", async () => {
    const stock = await database.query({ ...filters, mode: "stock-trend", stockCodes: ["00700"], limit: 1 });
    expect(stock.rows[0]).toMatchObject({ trading_date: "2026-01-02", stock_code: "00700" });
    expect(stock.truncated).toBe(true);
    const market = await database.query({ ...filters, mode: "market-trend" });
    expect(market.rows).toHaveLength(2);
    expect(market.rows[0].trading_date).toBe("2026-01-02");
  });
  it("resolves stock codes and escapes wildcard and injection-looking search text without modifying data", async () => {
    expect((await database.findStocks("700")).rows[0]).toMatchObject({ stock_code: "00700", stock_name: "TENCENT" });
    const wildcard = await database.findStocks("%");
    expect(wildcard.rows).toHaveLength(1);
    expect(wildcard.rows[0].stock_code).toBe("01234");
    expect((await database.findStocks("'; DROP TABLE public.insightful_hkex_short_selling; --")).rows).toHaveLength(0);
    expect((await client.query("SELECT count(*)::int AS count FROM public.insightful_hkex_short_selling")).rows[0].count).toBe(6);
  });
});
