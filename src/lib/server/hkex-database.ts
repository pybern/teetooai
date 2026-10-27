import type { Client } from "pg";
import { ConnectionError, createPostgresClient } from "./connections";
import type { DatabaseSettings } from "@/lib/connections";

export const HKEX_TABLE = "public.insightful_hkex_short_selling";
export const HKEX_QUERY_MODES = ["ranking", "stock-trend", "market-trend"] as const;
export const HKEX_METRICS = ["short_selling_value", "short_selling_shares", "short_turnover_percent"] as const;
export type HkexQuery = {
  mode: typeof HKEX_QUERY_MODES[number];
  from: string | null;
  to: string | null;
  stockCodes: string[];
  currency: "HKD" | "CNY" | "USD";
  board: "Main Board" | "GEM" | null;
  metric: typeof HKEX_METRICS[number];
  limit: number;
};
type DatabaseRow = Record<string, string | number | null>;
export type DatabaseEvidence = { sql: string; parameters: (string | string[] | number | null)[]; rows: DatabaseRow[]; truncated: boolean };

function date(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateHkexQuery(value: HkexQuery): HkexQuery {
  if (!value || !HKEX_QUERY_MODES.includes(value.mode) || !HKEX_METRICS.includes(value.metric) ||
    !["HKD", "CNY", "USD"].includes(value.currency) || ![null, "Main Board", "GEM"].includes(value.board) ||
    !date(value.from) || !date(value.to) || !Array.isArray(value.stockCodes) || value.stockCodes.length > 5 ||
    !value.stockCodes.every((code) => typeof code === "string" && /^\d{5}$/.test(code)) ||
    !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100) {
    throw new ConnectionError("Invalid HKEX filters. Use real ISO dates, five-digit stock codes, a supported currency and a limit from 1 to 100.");
  }
  if (value.from && value.to && (value.from > value.to || Date.parse(value.to) - Date.parse(value.from) > 366 * 86400000)) {
    throw new ConnectionError("HKEX date ranges must be chronological and no longer than 366 days.");
  }
  if (value.from && !value.to) throw new ConnectionError("Provide an end date when choosing a start date so the research range is explicit.");
  if (value.mode === "stock-trend" && !value.stockCodes.length) throw new ConnectionError("Choose at least one stock code for a stock trend.");
  return value;
}

export function buildHkexQuery(input: HkexQuery): { sql: string; parameters: DatabaseEvidence["parameters"] } {
  const query = validateHkexQuery(input);
  const trend = query.mode !== "ranking";
  const stock = query.mode !== "market-trend";
  const groups = [trend ? "trading_date" : null, stock ? "stock_code" : null, "trading_currency"].filter(Boolean).join(", ");
  const metric = query.metric;
  return {
    sql: `WITH latest AS (SELECT max(trading_date) AS day FROM ${HKEX_TABLE}
        WHERE $2::date IS NULL AND trading_currency = $3 AND ($4::text IS NULL OR board = $4)
          AND (cardinality($5::text[]) = 0 OR stock_code = ANY($5::text[]))),
      bounds AS (SELECT COALESCE($2::date, day) AS last_day,
        COALESCE($1::date, COALESCE($2::date, day) - ${trend ? 29 : 0}) AS first_day FROM latest)
      SELECT ${trend ? "trading_date::text AS trading_date," : ""}
        ${stock ? "stock_code, max(left(stock_name, 120)) AS stock_name," : ""}
        trading_currency, min(trading_date)::text AS first_date, max(trading_date)::text AS last_date,
        count(*)::text AS observations,
        sum(short_selling_shares)::text AS short_selling_shares,
        sum(short_selling_value)::text AS short_selling_value,
        sum(total_traded_shares)::text AS total_traded_shares,
        sum(total_turnover)::text AS total_turnover,
        round(100 * sum(short_selling_value) / nullif(sum(total_turnover), 0), 4)::text AS short_turnover_percent,
        min(left(source_url, 512)) AS source_url
      FROM ${HKEX_TABLE}, bounds
      WHERE trading_date BETWEEN first_day AND last_day
        AND trading_currency = $3
        AND ($4::text IS NULL OR board = $4)
        AND (cardinality($5::text[]) = 0 OR stock_code = ANY($5::text[]))
      GROUP BY ${groups}
      ORDER BY ${trend ? `trading_date ASC, ${stock ? "stock_code ASC," : ""} trading_currency ASC` : `${metric === "short_turnover_percent"
        ? "100 * sum(short_selling_value) / nullif(sum(total_turnover), 0)"
        : `sum(${metric})`} DESC NULLS LAST, stock_code ASC`}
      LIMIT $6`,
    parameters: [query.from, query.to, query.currency, query.board, query.stockCodes, query.limit + 1],
  };
}

export class HkexDatabase {
  private calls = 0;
  constructor(private settings: DatabaseSettings, private signal: AbortSignal) {}

  attachSignal(signal: AbortSignal) {
    this.signal = AbortSignal.any([this.signal, signal]);
  }

  private async read<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new ConnectionError("Database research was cancelled.", 499);
    if (++this.calls > 10) throw new ConnectionError("Database research reached its ten-read limit. Ask a narrower question.", 429);
    const client = createPostgresClient(this.settings, "insightful-hkex-agent", 10000);
    let connectionError: Error | undefined;
    client.on("error", (error: Error) => { connectionError = error; });
    const abort = () => { void client.end().catch(() => { console.error("HKEX database cancellation cleanup failed."); }); };
    this.signal.addEventListener("abort", abort, { once: true });
    try {
      await client.connect();
      if (this.signal.aborted) throw new ConnectionError("Database research was cancelled.", 499);
      await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'");
      const result = await operation(client);
      if (connectionError) throw connectionError;
      if (this.signal.aborted) throw new ConnectionError("Database research was cancelled.", 499);
      // No writes are permitted, and rollback also releases the read snapshot.
      await client.query("ROLLBACK");
      if (JSON.stringify(result).length > 32000) throw new ConnectionError("Database evidence exceeded 32,000 characters. Narrow the filters or reduce the result limit.", 413);
      return result;
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      if (this.signal.aborted) throw new ConnectionError("Database research was cancelled.", 499);
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      console.error("HKEX database read failed", { code });
      const messages: Record<string, string> = {
        "42P01": "The HKEX table is missing. Initialize the saved database from Configuration first.",
        "42703": "The existing HKEX table has an incompatible schema. Review it before querying; the agent cannot migrate tables.",
        "42501": "The saved database user needs SELECT access to the HKEX table.",
        "57014": "The HKEX query exceeded the database time limit. Narrow the date range or stock selection.",
      };
      throw new ConnectionError(messages[code] ?? "Could not read the saved PostgreSQL database. Check the connection, TLS and read permissions in Configuration.", 502);
    } finally {
      this.signal.removeEventListener("abort", abort);
      try { await client.end(); } catch { console.error("HKEX database connection cleanup failed."); }
    }
  }

  async inspect() {
    return this.read(async (client) => {
      const columns = (await client.query<DatabaseRow>(`SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'insightful_hkex_short_selling'
        ORDER BY ordinal_position`)).rows;
      if (!columns.length) throw new ConnectionError("The HKEX table is missing or not accessible. Initialize the saved database in Configuration and check SELECT permissions.", 409);
      const coverage = (await client.query<DatabaseRow>(`SELECT trading_currency, board,
        min(trading_date)::text AS first_date, max(trading_date)::text AS last_date,
        count(*)::text AS rows, count(DISTINCT stock_code)::text AS stocks,
        count(DISTINCT trading_date)::text AS trading_days
        FROM ${HKEX_TABLE} GROUP BY trading_currency, board ORDER BY trading_currency, board`)).rows;
      if (!coverage.length) throw new ConnectionError("The existing HKEX table is empty. The initializer skips existing tables; import data explicitly before running research.", 409);
      return { table: HKEX_TABLE, columns, coverage, note: "Coverage is from the saved database, not a live HKEX feed. Numeric amounts retain exact decimal strings." };
    });
  }

  async findStocks(search: string): Promise<DatabaseEvidence> {
    if (typeof search !== "string" || !search.trim() || search.length > 80 || /[\0\r\n]/.test(search)) {
      throw new ConnectionError("Stock lookup requires 1 to 80 characters of a stock code or name.");
    }
    const normalized = search.trim();
    const code = /^\d{1,5}$/.test(normalized) ? normalized.padStart(5, "0") : null;
    const pattern = `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
    const sql = `SELECT stock_code, max(left(stock_name, 120)) AS stock_name, trading_currency,
      min(trading_date)::text AS first_date, max(trading_date)::text AS last_date
      FROM ${HKEX_TABLE} WHERE stock_code = $1 OR stock_name ILIKE $2
      GROUP BY stock_code, trading_currency ORDER BY stock_code, trading_currency LIMIT 21`;
    return this.read(async (client) => {
      const rows = (await client.query<DatabaseRow>(sql, [code, pattern])).rows;
      return { sql, parameters: [code, pattern], rows: rows.slice(0, 20), truncated: rows.length > 20 };
    });
  }

  async query(input: HkexQuery): Promise<DatabaseEvidence> {
    const { sql, parameters } = buildHkexQuery(input);
    return this.read(async (client) => {
      const rows = (await client.query<DatabaseRow>(sql, parameters)).rows;
      return { sql, parameters, rows: rows.slice(0, input.limit), truncated: rows.length > input.limit };
    });
  }
}
