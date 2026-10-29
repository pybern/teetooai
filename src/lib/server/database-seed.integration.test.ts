import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DATASETS } from "@/lib/data";
import { initializeSavedDatabase, loadHkexSeed } from "./database-seed";
import { loadConnections, loadSavedApi, saveConnection } from "./connections";
import { HkexDatabase } from "./hkex-database";
import { HKEX_COVERAGE } from "@/lib/hkex-coverage";

const connectionString = process.env.TEST_POSTGRES_URL;
const api = { baseUrl: "https://api.example.test/v1", model: "seeded-model", apiKey: "test-private-api-key", reasoningEffort: "high" };

describe.skipIf(!connectionString)("database initialization against PostgreSQL", () => {
  let admin: Client;
  let client: Client;
  let directory: string;
  let name: string;

  beforeAll(async () => {
    admin = new Client({ connectionString });
    await admin.connect();
    directory = await mkdtemp(path.join(tmpdir(), "insightful-pg-seed-"));
  });
  beforeEach(async () => {
    name = `insightful_seedtest_${randomBytes(8).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(connectionString!);
    url.pathname = `/${name}`;
    client = new Client({ connectionString: url.href });
    await client.connect();
    const settingsPath = path.join(directory, `${name}.json`);
    await writeFile(settingsPath, JSON.stringify({
      api,
      database: {
        host: url.hostname, port: Number(url.port || 5432), database: name,
        username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        ssl: false, caCertificate: "",
      },
    }));
    vi.stubEnv("CONNECTION_CONFIG_PATH", settingsPath);
  });
  afterEach(async () => {
    await client?.end();
    // Only databases created by this test are removed; never the supplied database.
    if (name) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await admin?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("creates and seeds all source records with exact values, and leaves existing data unchanged on repeat", async () => {
    const result = await initializeSavedDatabase();
    const source = await loadHkexSeed();
    const observations = DATASETS.reduce((count, dataset) => count + dataset.rows.length, 0);
    expect(result.tables.map((table) => table.insertedRows)).toEqual([DATASETS.length, observations, source.rows.length, DATASETS.length + 2, 1]);
    expect((await client.query("SELECT settings FROM public.insightful_configuration WHERE kind = 'api'")).rows[0].settings).toEqual(api);
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).api).toBeUndefined();
    expect(await loadSavedApi()).toEqual(api);
    expect((await client.query("SELECT count(*)::int AS count FROM public.insightful_dataset_rows")).rows[0].count).toBe(observations);
    const dataset = (await client.query("SELECT metadata FROM public.insightful_datasets WHERE id = $1", [DATASETS[0].id])).rows[0].metadata;
    expect(dataset).toMatchObject({ source: DATASETS[0].source, rowCount: DATASETS[0].rows.length });
    const observation = (await client.query(
      "SELECT data FROM public.insightful_dataset_rows WHERE dataset_id = $1 AND row_index = 0", [DATASETS[0].id],
    )).rows[0].data;
    expect(observation).toEqual(DATASETS[0].rows[0]);
    const first = source.rows[0];
    const imported = (await client.query(`SELECT stock_code, stock_name, short_selling_shares::text,
      short_selling_value::text, total_traded_shares::text, total_turnover::text, trading_currency, source_url
      FROM public.insightful_hkex_short_selling WHERE trading_date = $1 AND stock_code = $2`,
    [first.trading_date, first.stock_code])).rows[0];
    for (const key of Object.keys(imported) as (keyof typeof first)[]) expect(imported[key]).toBe(first[key]);
    const totals = (await client.query(`SELECT trading_currency, count(*)::int AS count,
      SUM(short_selling_shares)::text AS shares FROM public.insightful_hkex_short_selling GROUP BY trading_currency`)).rows;
    for (const total of totals) {
      const matching = source.rows.filter((row) => row.trading_currency === total.trading_currency);
      expect(total.count).toBe(matching.length);
      expect(total.shares).toBe(matching.reduce((sum, row) => sum + BigInt(row.short_selling_shares), BigInt(0)).toString());
    }
    await client.query("UPDATE public.insightful_datasets SET metadata = metadata || '{\"custom_marker\": true}'::jsonb");
    await client.query("DELETE FROM public.insightful_hkex_short_selling WHERE trading_date = $1 AND stock_code = $2", [first.trading_date, first.stock_code]);
    const second = await initializeSavedDatabase();
    expect(second.tables.map((table) => table.status)).toEqual(["skipped", "skipped", "skipped", "seeded", "skipped"]);
    expect((await client.query("SELECT row_count::int FROM public.insightful_table_catalog WHERE id = 'hkex_short_selling'")).rows[0].row_count)
      .toBe(source.rows.length - 1);
    expect((await client.query("SELECT count(*)::int AS count FROM public.insightful_datasets WHERE metadata->>'custom_marker' = 'true'")).rows[0].count).toBe(DATASETS.length);
    expect((await client.query("SELECT count(*)::int AS count FROM public.insightful_hkex_short_selling")).rows[0].count).toBe(source.rows.length - 1);
  }, 30000);

  it("creates only missing tables when a compatible dataset catalog already exists", async () => {
    await initializeSavedDatabase();
    await client.query("DROP TABLE public.insightful_hkex_short_selling");
    const result = await initializeSavedDatabase();
    expect(result.tables.map((table) => table.status)).toEqual(["skipped", "skipped", "created", "seeded", "skipped"]);
    expect(result.tables[2].insertedRows).toBe(34077);
  }, 30000);

  it("seeds a searchable table catalog that the agent can describe and query through the SQL guard", async () => {
    await initializeSavedDatabase();
    const entries = (await client.query("SELECT id, relation, jsonb_array_length(sample_rows) AS samples, row_count::int FROM public.insightful_table_catalog ORDER BY id")).rows;
    expect(entries).toHaveLength(DATASETS.length + 2);
    expect(entries.every((entry) => entry.samples > 0 && entry.row_count > 0)).toBe(true);
    expect(entries.some((entry) => /configuration/.test(entry.relation))).toBe(false);
    const url = new URL(connectionString!);
    const research = new HkexDatabase({
      host: url.hostname, port: Number(url.port || 5432), database: name,
      username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false, caCertificate: "",
    }, new AbortController().signal);
    expect((await research.inspect()).catalog).toHaveLength(DATASETS.length + 2);
    const emissions = await research.searchCatalog("carbon emissions by country");
    expect(emissions.rows.map((row) => row.id)).toContain("dataset:co2-emitters");
    expect((await research.searchCatalog("short selling turnover")).rows[0].id).toBe("hkex_short_selling");
    const described = (await research.describeCatalog("dataset:us-macro")).rows[0] as unknown as { example_queries: { sql: string }[]; columns: { name: string }[] };
    expect(described.columns.map((column) => column.name)).toContain("inflation");
    for (const entry of entries) {
      const detail = (await new HkexDatabase(research["settings"], new AbortController().signal).describeCatalog(entry.id)).rows[0] as unknown as { example_queries: { sql: string }[] };
      for (const example of detail.example_queries) {
        const result = await new HkexDatabase(research["settings"], new AbortController().signal).runAgentSql(example.sql);
        expect(result.rows.length, `${entry.id}: ${example.sql}`).toBeGreaterThan(0);
      }
    }
    await expect(research.runAgentSql("SELECT settings FROM public.insightful_configuration")).rejects.toThrow("not in the catalog");
    await expect(research.runAgentSql("SELECT nope FROM public.insightful_datasets")).rejects.toThrow('column "nope" does not exist');
    const settings = research["settings"];
    const hk = () => new HkexDatabase(settings, new AbortController().signal, { datasetIds: ["hk-indices", "hk-valuations", "hk-prices", "hk-financials"] });
    const scopedDatasets = await hk().runAgentSql(`SELECT DISTINCT r.dataset_id FROM public.insightful_dataset_rows r
      JOIN insightful_datasets d ON d.id = r.dataset_id ORDER BY 1`);
    expect(scopedDatasets.rows.map((row) => row.dataset_id)).toEqual(["hk-financials", "hk-indices", "hk-prices", "hk-valuations"]);
    expect((await hk().runAgentSql("SELECT count(*) AS n FROM insightful_dataset_rows WHERE dataset_id = 'us-macro'")).rows[0].n).toBe("0");
    expect((await hk().searchCatalog("inflation unemployment")).rows).toEqual([]);
    await expect(hk().describeCatalog("dataset:us-macro")).rejects.toThrow("No catalog entry");
    expect((await hk().inspect()).catalog?.map((entry) => entry.id).sort()).toEqual(
      ["dataset:hk-financials", "dataset:hk-indices", "dataset:hk-prices", "dataset:hk-valuations", "hkex_short_selling", "insightful_datasets"]);
    const marketTrend = await new HkexDatabase(settings, new AbortController().signal).query({
      mode: "market-trend", from: null, to: null, stockCodes: [], currency: "HKD", board: null, metric: "short_selling_value", limit: 100,
    });
    expect(marketTrend.rows).toHaveLength(HKEX_COVERAGE.tradingDays);
    expect(marketTrend.rows[0].trading_date).toBe(HKEX_COVERAGE.from);
    expect(marketTrend.rows.at(-1)!.trading_date).toBe(HKEX_COVERAGE.to);
    const limited = await research.runAgentSql("SELECT * FROM public.insightful_hkex_short_selling", 5);
    expect(limited.rows).toHaveLength(5);
    expect(limited.truncated).toBe(true);
    expect(typeof limited.rows[0].trading_date).toBe("string");
  }, 60000);

  it("persists API updates in PostgreSQL, retains omitted secrets and keeps migrated values on repeat initialization", async () => {
    await initializeSavedDatabase();
    await saveConnection("api", { baseUrl: api.baseUrl, model: "updated-model", reasoningEffort: "max" });
    expect(await loadSavedApi()).toEqual({ ...api, model: "updated-model", reasoningEffort: "max" });
    const bootstrap = JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"));
    expect(bootstrap.api).toBeUndefined();
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ ...bootstrap, api }));
    await initializeSavedDatabase();
    expect((await loadConnections()).api.model).toBe("updated-model");
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).api).toBeUndefined();
    await saveConnection("api", { baseUrl: api.baseUrl, model: api.model, apiKey: "" });
    expect((await loadSavedApi()).apiKey).toBe("");
  }, 30000);

  it("imports a missing API row into an existing settings table without reseeding dataset tables", async () => {
    await initializeSavedDatabase();
    await client.query("DELETE FROM public.insightful_configuration WHERE kind = 'api'");
    const bootstrap = JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8"));
    await writeFile(process.env.CONNECTION_CONFIG_PATH!, JSON.stringify({ ...bootstrap, api }));
    const result = await initializeSavedDatabase();
    expect(result.tables.slice(0, 3).every((table) => table.status === "skipped")).toBe(true);
    expect(result.tables.at(-1)).toEqual({ name: "public.insightful_configuration", status: "seeded", insertedRows: 1 });
    expect(await loadSavedApi()).toEqual(api);
    expect(JSON.parse(await readFile(process.env.CONNECTION_CONFIG_PATH!, "utf8")).api).toBeUndefined();
  }, 30000);

  it("rolls back new tables and all seed inserts when an existing catalog cannot satisfy foreign keys", async () => {
    await client.query("CREATE TABLE public.insightful_datasets (id text PRIMARY KEY, metadata jsonb NOT NULL)");
    await client.query("INSERT INTO public.insightful_datasets VALUES ('existing-data', '{\"preserved\":true}')");
    await expect(initializeSavedDatabase()).rejects.toThrow("missing required dataset IDs");
    const state = (await client.query(`SELECT to_regclass('public.insightful_dataset_rows') AS observations,
      to_regclass('public.insightful_hkex_short_selling') AS hkex`)).rows[0];
    expect(state).toEqual({ observations: null, hkex: null });
    expect((await client.query("SELECT * FROM public.insightful_datasets")).rows).toEqual([{ id: "existing-data", metadata: { preserved: true } }]);
  });

  it("rejects a second initializer while another transaction holds the initialization lock", async () => {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('insightful:initialize:v1'))");
    try {
      await expect(initializeSavedDatabase()).rejects.toThrow("already running");
    } finally { await client.query("ROLLBACK"); }
    expect((await client.query("SELECT to_regclass('public.insightful_datasets') AS catalog")).rows[0].catalog).toBeNull();
  });
});
