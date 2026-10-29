import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { Client } from "pg";
import { DATASETS } from "@/lib/data";
import type { DatabaseInitializationResult } from "@/lib/connections";
import {
  CONFIGURATION_TABLE, ConnectionError, createPostgresClient, loadBootstrapConnections,
  loadSavedDatabase, removeLegacyApi, updateConnectionStorage,
} from "./connections";
import type { ApiSettings } from "@/lib/connections";
import { buildCatalogEntries, CATALOG_TABLE_DEFINITION, loadHkexCatalogStats, upsertCatalog } from "./table-catalog";

export const HKEX_COLUMNS = [
  "board", "trading_date", "stock_code", "stock_name", "short_selling_shares",
  "short_selling_value", "total_traded_shares", "total_turnover", "trading_currency", "source_url",
] as const;
type HkexRow = Record<typeof HKEX_COLUMNS[number], string>;

const TABLES = [
  {
    name: "public.insightful_datasets",
    create: `CREATE TABLE public.insightful_datasets (
      id text PRIMARY KEY,
      metadata jsonb NOT NULL,
      seeded_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    name: "public.insightful_dataset_rows",
    create: `CREATE TABLE public.insightful_dataset_rows (
      dataset_id text NOT NULL REFERENCES public.insightful_datasets(id),
      row_index integer NOT NULL CHECK (row_index >= 0),
      data jsonb NOT NULL,
      PRIMARY KEY (dataset_id, row_index)
    )`,
  },
  {
    name: "public.insightful_hkex_short_selling",
    create: `CREATE TABLE public.insightful_hkex_short_selling (
      board text NOT NULL CHECK (board IN ('Main Board', 'GEM')),
      trading_date date NOT NULL,
      stock_code text NOT NULL CHECK (stock_code ~ '^[0-9]{5}$'),
      stock_name text NOT NULL,
      short_selling_shares bigint NOT NULL CHECK (short_selling_shares >= 0),
      short_selling_value numeric NOT NULL CHECK (short_selling_value >= 0),
      total_traded_shares bigint NOT NULL CHECK (total_traded_shares >= 0),
      total_turnover numeric NOT NULL CHECK (total_turnover >= 0),
      trading_currency text NOT NULL CHECK (trading_currency IN ('HKD', 'CNY', 'USD')),
      source_url text NOT NULL,
      PRIMARY KEY (trading_date, stock_code)
    )`,
  },
  CATALOG_TABLE_DEFINITION,
  CONFIGURATION_TABLE,
] as const;

function seedDataError(message: string) {
  return new ConnectionError(`Bundled seed data is invalid: ${message}. No initialization changes were committed.`, 500);
}

function isHkexRow(value: unknown): value is HkexRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return HKEX_COLUMNS.every((column) => typeof row[column] === "string" && !row[column].includes("\0"));
}

export function parseHkexSeed(source: string): HkexRow[] {
  let records: unknown;
  try {
    records = parse(source, {
      bom: true,
      skip_empty_lines: true,
      columns: (header: string[]) => {
        if (header.join(",") !== HKEX_COLUMNS.join(",")) throw seedDataError("unexpected HKEX CSV columns");
        return header;
      },
    });
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw seedDataError("HKEX CSV could not be parsed");
  }
  if (!Array.isArray(records) || !records.length) throw seedDataError("HKEX CSV is empty");
  const keys = new Set<string>();
  return records.map((record: unknown, index) => {
    if (!isHkexRow(record)) throw seedDataError(`HKEX row ${index + 2} has missing or invalid fields`);
    const date = new Date(`${record.trading_date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.trading_date) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== record.trading_date ||
      !["Main Board", "GEM"].includes(record.board) || !["HKD", "CNY", "USD"].includes(record.trading_currency) ||
      !/^\d{5}$/.test(record.stock_code) || !record.stock_name.trim() ||
      !/^https:\/\/www\.hkex\.com\.hk\//.test(record.source_url)) {
      throw seedDataError(`HKEX row ${index + 2} has invalid date, board, stock, currency or source`);
    }
    for (const column of ["short_selling_shares", "total_traded_shares"] as const) {
      if (!/^(0|[1-9]\d*)$/.test(record[column]) || BigInt(record[column]) > BigInt("9223372036854775807")) {
        throw seedDataError(`HKEX row ${index + 2} has invalid share counts`);
      }
    }
    for (const column of ["short_selling_value", "total_turnover"] as const) {
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(record[column])) throw seedDataError(`HKEX row ${index + 2} has invalid monetary values`);
    }
    const key = `${record.trading_date}:${record.stock_code}`;
    if (keys.has(key)) throw seedDataError(`HKEX CSV contains a duplicate date/stock key at row ${index + 2}`);
    keys.add(key);
    return record;
  });
}

export async function loadHkexSeed() {
  let source: string;
  let coverage: unknown;
  try {
    const [csv, manifest] = await Promise.all([
      readFile(path.join(process.cwd(), "data/hkex/hkex-short-selling.csv"), "utf8"),
      readFile(path.join(process.cwd(), "data/hkex/hkex-coverage.json"), "utf8"),
    ]);
    source = csv;
    coverage = JSON.parse(manifest);
  } catch {
    throw new ConnectionError("Could not read the bundled HKEX CSV and coverage manifest. Include both data/hkex seed files in the deployment. No initialization changes were committed.", 500);
  }
  const rows = parseHkexSeed(source);
  const dates = rows.map((row) => row.trading_date).sort();
  const summary = { records: rows.length, from: dates[0], to: dates[dates.length - 1], currencies: [...new Set(rows.map((row) => row.trading_currency))].sort() };
  if (!coverage || typeof coverage !== "object" || !("rows" in coverage) ||
    coverage.rows !== rows.length || !("accessible_start" in coverage) || coverage.accessible_start !== summary.from ||
    !("accessible_end" in coverage) || coverage.accessible_end !== summary.to) {
    throw seedDataError("HKEX CSV does not match its coverage manifest");
  }
  return { rows, summary };
}

async function insertBatches(client: Client, sql: string, rows: unknown[], checkActive: () => void) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 1000) {
    checkActive();
    const batch = rows.slice(offset, offset + 1000);
    const result = await client.query(sql, [JSON.stringify(batch)]);
    if (result.rowCount !== batch.length) throw new ConnectionError("Seed insert count did not match the source batch. No initialization changes were committed.", 500);
    inserted += result.rowCount;
  }
  return inserted;
}

let initializing = false;
export function initializeSavedDatabase(signal?: AbortSignal): Promise<DatabaseInitializationResult> {
  if (initializing) return Promise.reject(new ConnectionError("Another initialization is already running on this server. Try again after it completes.", 409));
  initializing = true;
  return updateConnectionStorage(async () => {
    const { api } = await loadBootstrapConnections();
    const result = await initializeDatabase(signal, api);
    try { await removeLegacyApi(); } catch {
      throw new ConnectionError("Database initialization committed, but the legacy API settings could not be removed from the bootstrap file. Check file permissions and retry initialization.", 500);
    }
    return result;
  }).finally(() => { initializing = false; });
}

async function initializeDatabase(signal?: AbortSignal, legacyApi?: ApiSettings): Promise<DatabaseInitializationResult> {
  const started = Date.now();
  const settings = await loadSavedDatabase();
  const client = createPostgresClient(settings, "insightful-database-initialize", 60000);
  let connectionError: Error | undefined;
  client.on("error", (error: Error) => { connectionError = error; });
  let inTransaction = false;
  let committed = false;
  const checkActive = () => {
    if (signal?.aborted) throw new ConnectionError("Initialization cancelled. No initialization changes were committed.", 499);
    if (connectionError) throw connectionError;
    if (Date.now() - started > 120000) throw new ConnectionError("Initialization exceeded the two-minute time limit. No initialization changes were committed.", 504);
  };
  try {
    checkActive();
    await client.connect();
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('insightful:initialize:v1')) AS locked");
    if (!lock.rows[0]?.locked) throw new ConnectionError("Another initialization is already running for this database. Try again after it completes.", 409);
    const tables: DatabaseInitializationResult["tables"] = [];
    let hkexCoverage: DatabaseInitializationResult["hkexCoverage"];
    for (const table of TABLES) {
      checkActive();
      const existing = await client.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [table.name]);
      if (table.name === CONFIGURATION_TABLE.name) {
        if (!existing.rows[0]?.relation) {
          await client.query(table.create);
          await client.query("REVOKE ALL ON TABLE public.insightful_configuration FROM PUBLIC");
        }
        const seeded = legacyApi ? await client.query(
          `INSERT INTO public.insightful_configuration (kind, settings)
           SELECT kind, settings FROM jsonb_to_recordset($1::jsonb) AS r(kind text, settings jsonb)
           ON CONFLICT (kind) DO NOTHING`, [JSON.stringify([{ kind: "api", settings: legacyApi }])],
        ) : undefined;
        if (legacyApi && seeded?.rowCount !== 0 && seeded?.rowCount !== 1) {
          throw new ConnectionError("Configuration migration returned an unexpected insert count. No initialization changes were committed.", 500);
        }
        const insertedRows = seeded?.rowCount ?? 0;
        tables.push({
          name: table.name,
          status: existing.rows[0]?.relation ? (insertedRows ? "seeded" : "skipped") : "created",
          insertedRows,
        });
        continue;
      }
      if (table.name === CATALOG_TABLE_DEFINITION.name) {
        // The catalog only documents seeded tables, so it is refreshed on every run to match the current code and data.
        if (!existing.rows[0]?.relation) {
          await client.query(table.create);
          for (const index of CATALOG_TABLE_DEFINITION.indexes) await client.query(index);
        }
        const insertedRows = await upsertCatalog(client, buildCatalogEntries(await loadHkexCatalogStats(client)));
        tables.push({ name: table.name, status: existing.rows[0]?.relation ? "seeded" : "created", insertedRows });
        continue;
      }
      if (existing.rows[0]?.relation) {
        tables.push({ name: table.name, status: "skipped", insertedRows: 0 });
        continue;
      }
      await client.query(table.create);
      let insertedRows: number;
      if (table.name === "public.insightful_datasets") {
        const records = DATASETS.map(({ rows, ...metadata }) => ({ id: metadata.id, metadata: { ...metadata, rowCount: rows.length } }));
        insertedRows = await insertBatches(client,
          "INSERT INTO public.insightful_datasets (id, metadata) SELECT id, metadata FROM jsonb_to_recordset($1::jsonb) AS r(id text, metadata jsonb)",
          records, checkActive);
      } else if (table.name === "public.insightful_dataset_rows") {
        const records = DATASETS.flatMap((dataset) => dataset.rows.map((data, row_index) => ({ dataset_id: dataset.id, row_index, data })));
        insertedRows = await insertBatches(client,
          "INSERT INTO public.insightful_dataset_rows (dataset_id, row_index, data) SELECT dataset_id, row_index, data FROM jsonb_to_recordset($1::jsonb) AS r(dataset_id text, row_index integer, data jsonb)",
          records, checkActive);
      } else {
        const hkex = await loadHkexSeed();
        hkexCoverage = hkex.summary;
        insertedRows = await insertBatches(client,
          `INSERT INTO public.insightful_hkex_short_selling (${HKEX_COLUMNS.join(", ")})
           SELECT ${HKEX_COLUMNS.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS r(
             board text, trading_date date, stock_code text, stock_name text, short_selling_shares bigint,
             short_selling_value numeric, total_traded_shares bigint, total_turnover numeric, trading_currency text, source_url text
           )`, hkex.rows, checkActive);
      }
      tables.push({ name: table.name, status: "created", insertedRows });
    }
    checkActive();
    await client.query("COMMIT");
    inTransaction = false;
    committed = true;
    return {
      ok: true, database: settings.database, host: settings.host, port: settings.port,
      tables, durationMs: Date.now() - started, ...(hkexCoverage ? { hkexCoverage } : {}),
    };
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch {
        throw new ConnectionError("Database initialization failed and rollback could not be confirmed. Check the database state before retrying.", 502);
      }
    }
    if (error instanceof ConnectionError) throw error;
    const code = (error as { code?: string }).code;
    const reasons: Record<string, string> = {
      "42501": "The saved database user needs CREATE permission on schema public and permission to reference the existing dataset catalog.",
      "23503": "The existing dataset catalog is missing required dataset IDs. Existing tables were not modified; review the catalog before initializing dependent tables.",
      "42P07": "A target relation was created by another operation. Retry initialization.",
      "42703": "An existing dataset catalog has an incompatible schema. No existing tables were modified.",
      "42830": "The existing dataset catalog has an incompatible primary key. No existing tables were modified.",
      "55P03": "A database lock could not be acquired within five seconds. Retry when the database is less busy.",
      "57014": "A database statement timed out. Check database capacity and retry.",
      "28P01": "Authentication failed. Check and save the database credentials.",
      ECONNREFUSED: "Connection refused. Check the saved database host, port and network access.",
    };
    throw new ConnectionError(`${reasons[code ?? ""] ?? "Check the saved connection, TLS, database permissions and schema compatibility."} Initialization did not commit.`, 502);
  } finally {
    try { await client.end(); } catch {
      if (!committed) throw new ConnectionError("Database cleanup failed after initialization. Check the database state before retrying.", 502);
      console.error("Database initialization committed but connection cleanup failed");
    }
  }
}
