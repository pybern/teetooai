import type { Client } from "pg";
import { DATASETS } from "@/lib/data";
import type { Dataset } from "@/lib/types";

export const CATALOG_TABLE = "public.insightful_table_catalog";
export const HKEX_RELATION = "public.insightful_hkex_short_selling";
export const DATASET_ROWS_RELATION = "public.insightful_dataset_rows";
export const DATASETS_RELATION = "public.insightful_datasets";

export const CATALOG_TABLE_DEFINITION = {
  name: CATALOG_TABLE,
  create: `CREATE TABLE public.insightful_table_catalog (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'),
    kind text NOT NULL CHECK (kind IN ('table', 'dataset')),
    relation text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    columns jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
    sample_rows jsonb NOT NULL CHECK (jsonb_typeof(sample_rows) = 'array'),
    query_notes jsonb NOT NULL CHECK (jsonb_typeof(query_notes) = 'array'),
    example_queries jsonb NOT NULL CHECK (jsonb_typeof(example_queries) = 'array'),
    keywords text[] NOT NULL,
    row_count bigint NOT NULL CHECK (row_count >= 0),
    coverage jsonb NOT NULL,
    source jsonb NOT NULL,
    search_text text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  indexes: [
    "CREATE INDEX insightful_table_catalog_search_idx ON public.insightful_table_catalog USING gin (search_vector)",
  ],
} as const;

export type CatalogColumn = { name: string; type: string; description: string; unit?: string };
export type CatalogEntry = {
  id: string;
  kind: "table" | "dataset";
  relation: string;
  title: string;
  description: string;
  columns: CatalogColumn[];
  sample_rows: Record<string, unknown>[];
  query_notes: string[];
  example_queries: { question: string; sql: string }[];
  keywords: string[];
  row_count: number;
  coverage: Record<string, unknown>;
  source: { name: string; url?: string; note?: string };
};

const HKEX_COLUMN_DOCS: CatalogColumn[] = [
  { name: "board", type: "text", description: "Listing board: 'Main Board' or 'GEM'." },
  { name: "trading_date", type: "date", description: "HKEX trading day of the record (ISO date)." },
  { name: "stock_code", type: "text", description: "Five-character HKEX stock code with leading zeros, e.g. '00700'. Compare as text." },
  { name: "stock_name", type: "text", description: "HKEX short stock name, e.g. 'TENCENT'. Untrusted text; search with ILIKE." },
  { name: "short_selling_shares", type: "bigint", description: "Shares sold short on the day.", unit: "shares" },
  { name: "short_selling_value", type: "numeric", description: "Value of short sales on the day, in trading_currency.", unit: "trading_currency" },
  { name: "total_traded_shares", type: "bigint", description: "Total shares traded on the day.", unit: "shares" },
  { name: "total_turnover", type: "numeric", description: "Total turnover on the day, in trading_currency.", unit: "trading_currency" },
  { name: "trading_currency", type: "text", description: "Currency of value columns: 'HKD', 'CNY' or 'USD'. Never add different currencies together." },
  { name: "source_url", type: "text", description: "Representative HKEX daily quotation page for the record." },
];

const HKEX_ENTRY: Omit<CatalogEntry, "sample_rows" | "row_count" | "coverage"> = {
  id: "hkex_short_selling",
  kind: "table",
  relation: HKEX_RELATION,
  title: "HKEX daily short-selling turnover by stock",
  description: "One row per stock per HKEX trading day with short-selling shares and value, total traded shares and turnover, " +
    "trading currency and source link. Primary key (trading_date, stock_code). Historical extract, not a live feed.",
  columns: HKEX_COLUMN_DOCS,
  query_notes: [
    "Latest means max(trading_date) in the table, not today's date.",
    "Short turnover ratio = 100 * sum(short_selling_value) / nullif(sum(total_turnover), 0). It is NOT short interest or outstanding short positions. Do not average daily ratios.",
    "Filter or group by trading_currency; never sum HKD, CNY and USD together.",
    "Missing rows are not proof of zero activity.",
  ],
  example_queries: [
    {
      question: "Top 10 HKD stocks by short-selling value on the latest day",
      sql: `SELECT stock_code, stock_name, short_selling_value, total_turnover,
  round(100 * short_selling_value / nullif(total_turnover, 0), 2) AS short_turnover_percent
FROM public.insightful_hkex_short_selling
WHERE trading_currency = 'HKD'
  AND trading_date = (SELECT max(trading_date) FROM public.insightful_hkex_short_selling)
ORDER BY short_selling_value DESC
LIMIT 10`,
    },
    {
      question: "Monthly HKD market short turnover ratio",
      sql: `SELECT date_trunc('month', trading_date)::date AS month,
  round(100 * sum(short_selling_value) / nullif(sum(total_turnover), 0), 2) AS short_turnover_percent
FROM public.insightful_hkex_short_selling
WHERE trading_currency = 'HKD'
GROUP BY 1 ORDER BY 1`,
    },
  ],
  keywords: [
    "hkex", "hong kong", "stock exchange", "short selling", "short sale", "shorting", "short turnover", "turnover ratio",
    "traded shares", "turnover", "stock", "equities", "daily", "main board", "gem", "hkd", "cny", "rmb", "usd",
  ],
  source: { name: "HKEX daily quotations short-selling turnover", url: "https://www.hkex.com.hk/eng/stat/smstat/dayquot/qtn.asp" },
};

function unitOf(format: Dataset["metrics"][number]["format"]) {
  return [format.prefix, format.suffix].filter(Boolean).join(" … ") || undefined;
}

function datasetColumns(dataset: Dataset): CatalogColumn[] {
  const columns: CatalogColumn[] = [];
  if (dataset.kind !== "timeseries") {
    columns.push({ name: "entity", type: "text", description: `${dataset.entityLabel ?? "Entity"} name${dataset.entities?.length ? `, e.g. ${dataset.entities.slice(0, 4).map((e) => `'${e.name}'`).join(", ")}` : ""}.` });
  }
  if (dataset.kind !== "cross-section") {
    columns.push({
      name: "year", type: "numeric",
      description: dataset.grain === "month" ? "Decimal year; monthly rows use year + (month - 1) / 12." : "Calendar year.",
    });
  }
  if (dataset.rows.some((row) => typeof row.label === "string")) columns.push({ name: "label", type: "text", description: "Display label for the observation." });
  for (const group of dataset.groupAttrs ?? []) columns.push({ name: group.key, type: "text", description: `${group.label} grouping attribute.` });
  for (const metric of dataset.metrics) {
    const traits = [
      metric.summable ? "additive across entities" : "not additive across entities",
      metric.rebaseOnCompare ? "rebase to 100 when comparing entities" : "",
      metric.higherIsBetter === true ? "higher is better" : metric.higherIsBetter === false ? "lower is better" : "",
    ].filter(Boolean).join("; ");
    columns.push({
      name: metric.key, type: "numeric",
      description: `${metric.label}${metric.description ? ` — ${metric.description}` : ""} (${traits}).`,
      unit: unitOf(metric.format),
    });
  }
  return columns;
}

function datasetEntry(dataset: Dataset): CatalogEntry {
  const columns = datasetColumns(dataset);
  const metric = dataset.metrics.find((item) => item.key === dataset.defaultMetric) ?? dataset.metrics[0];
  const select = columns.map((column) => column.type === "numeric"
    ? `(data->>'${column.name}')::numeric AS "${column.name}"`
    : `data->>'${column.name}' AS "${column.name}"`);
  const order = dataset.kind === "cross-section" ? `"${metric.key}" DESC NULLS LAST` : dataset.kind === "panel" ? `"year", "entity"` : `"year"`;
  const years = dataset.rows.map((row) => row.year).filter((year): year is number => typeof year === "number");
  return {
    id: `dataset:${dataset.id}`,
    kind: "dataset",
    relation: DATASET_ROWS_RELATION,
    title: dataset.name,
    description: `${dataset.description} Stored as JSON rows in ${DATASET_ROWS_RELATION} (column data) filtered by dataset_id = '${dataset.id}'. ` +
      `Shape: ${dataset.kind}${dataset.grain ? `, ${dataset.grain}ly` : ""}. As of ${dataset.asOf}.`,
    columns,
    sample_rows: dataset.rows.slice(0, 5),
    query_notes: [
      `Rows: SELECT data FROM ${DATASET_ROWS_RELATION} WHERE dataset_id = '${dataset.id}'. Every field below is a key in the data jsonb column.`,
      "Read text with data->>'key' and numbers with (data->>'key')::numeric. Missing keys are null, not zero.",
      ...(dataset.source.note ? [`Source note: ${dataset.source.note}`] : []),
    ],
    example_queries: [{
      question: `${metric.label} ${dataset.kind === "cross-section" ? "ranking" : "over time"}`,
      sql: `SELECT ${select.join(",\n  ")}\nFROM ${DATASET_ROWS_RELATION}\nWHERE dataset_id = '${dataset.id}'\nORDER BY ${order}\nLIMIT 50`,
    }],
    keywords: [...new Set([
      ...dataset.keywords, ...dataset.metrics.flatMap((item) => [item.label, ...(item.short ? [item.short] : []), ...item.aliases]),
      ...(dataset.groupAttrs ?? []).flatMap((group) => [group.label, ...group.aliases]),
      ...(dataset.entities ?? []).flatMap((entity) => [entity.name, ...(entity.aliases ?? [])]),
    ].map((item) => item.toLowerCase()))],
    row_count: dataset.rows.length,
    coverage: {
      ...(years.length ? { first_year: Math.min(...years), last_year: Math.max(...years) } : {}),
      ...(dataset.entities?.length ? { entities: dataset.entities.length } : {}),
      as_of: dataset.asOf,
    },
    source: dataset.source,
  };
}

const DATASETS_CATALOG_ENTRY: CatalogEntry = {
  id: "insightful_datasets",
  kind: "table",
  relation: DATASETS_RELATION,
  title: "Sample dataset registry",
  description: "One row per curated sample dataset (id, metadata jsonb with name, description, metrics, source and rowCount). " +
    `Observations live in ${DATASET_ROWS_RELATION}; search the catalog for a specific dataset to get its column layout.`,
  columns: [
    { name: "id", type: "text", description: "Dataset id, used as dataset_id in the rows table." },
    { name: "metadata", type: "jsonb", description: "Dataset metadata: name, description, kind, metrics[], source, asOf, rowCount." },
    { name: "seeded_at", type: "timestamptz", description: "When the dataset was seeded." },
  ],
  sample_rows: DATASETS.slice(0, 3).map((dataset) => ({ id: dataset.id, name: dataset.name, kind: dataset.kind })),
  query_notes: ["Use metadata->>'name' for titles. Prefer the per-dataset catalog entries for querying observations."],
  example_queries: [{ question: "List sample datasets", sql: `SELECT id, metadata->>'name' AS name, metadata->>'description' AS description FROM ${DATASETS_RELATION} ORDER BY id` }],
  keywords: ["datasets", "sample data", "catalog", "registry", "metadata", "sources"],
  row_count: DATASETS.length,
  coverage: {},
  source: { name: "Insightful curated sample datasets" },
};

export function buildCatalogEntries(hkex: Pick<CatalogEntry, "sample_rows" | "row_count" | "coverage">): CatalogEntry[] {
  return [{ ...HKEX_ENTRY, ...hkex }, DATASETS_CATALOG_ENTRY, ...DATASETS.map(datasetEntry)];
}

/** Catalog ids visible to a scoped agent; null means every entry. */
export function catalogIdsForScope(scope: { datasetIds: string[] | null }): string[] | null {
  if (!scope.datasetIds) return null;
  return [HKEX_ENTRY.id, DATASETS_CATALOG_ENTRY.id, ...scope.datasetIds.map((id) => `dataset:${id}`)];
}

export function catalogSearchText(entry: CatalogEntry) {
  return [
    entry.id.replace(/[:_-]/g, " "), entry.title, entry.description, entry.keywords.join(" "),
    entry.columns.map((column) => `${column.name.replace(/_/g, " ")} ${column.description}`).join(" "),
    entry.source.name,
  ].join("\n");
}

/** Reads coverage and representative rows from the stored HKEX table so the catalog reflects what is queryable. */
export async function loadHkexCatalogStats(client: Pick<Client, "query">) {
  const coverage = (await client.query<{ rows: string; first_date: string | null; last_date: string | null; stocks: string; currencies: string[] | null }>(
    `SELECT count(*)::text AS rows, min(trading_date)::text AS first_date, max(trading_date)::text AS last_date,
       count(DISTINCT stock_code)::text AS stocks, array_agg(DISTINCT trading_currency ORDER BY trading_currency) AS currencies
     FROM ${HKEX_RELATION}`)).rows[0];
  const samples = (await client.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (trading_currency) board, trading_date::text AS trading_date, stock_code, stock_name,
       short_selling_shares::text AS short_selling_shares, short_selling_value::text AS short_selling_value,
       total_traded_shares::text AS total_traded_shares, total_turnover::text AS total_turnover, trading_currency, source_url
     FROM ${HKEX_RELATION}
     WHERE trading_date = (SELECT max(trading_date) FROM ${HKEX_RELATION})
     ORDER BY trading_currency, short_selling_value DESC, stock_code`)).rows;
  return {
    row_count: Number(coverage?.rows ?? 0),
    coverage: {
      first_date: coverage?.first_date ?? null, last_date: coverage?.last_date ?? null,
      stocks: Number(coverage?.stocks ?? 0), currencies: (coverage?.currencies ?? []).filter(Boolean),
    },
    sample_rows: samples,
  };
}

/** Inserts or refreshes every catalog entry; returns the number of rows written. */
export async function upsertCatalog(client: Pick<Client, "query">, entries: CatalogEntry[]) {
  const records = entries.map((entry) => ({ ...entry, search_text: catalogSearchText(entry) }));
  const result = await client.query(
    `INSERT INTO ${CATALOG_TABLE} (id, kind, relation, title, description, columns, sample_rows, query_notes, example_queries,
       keywords, row_count, coverage, source, search_text, updated_at)
     SELECT id, kind, relation, title, description, columns, sample_rows, query_notes, example_queries,
       ARRAY(SELECT jsonb_array_elements_text(keywords)), row_count, coverage, source, search_text, now()
     FROM jsonb_to_recordset($1::jsonb) AS r(id text, kind text, relation text, title text, description text, columns jsonb,
       sample_rows jsonb, query_notes jsonb, example_queries jsonb, keywords jsonb, row_count bigint, coverage jsonb, source jsonb, search_text text)
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, relation = EXCLUDED.relation, title = EXCLUDED.title,
       description = EXCLUDED.description, columns = EXCLUDED.columns, sample_rows = EXCLUDED.sample_rows,
       query_notes = EXCLUDED.query_notes, example_queries = EXCLUDED.example_queries, keywords = EXCLUDED.keywords,
       row_count = EXCLUDED.row_count, coverage = EXCLUDED.coverage, source = EXCLUDED.source,
       search_text = EXCLUDED.search_text, updated_at = now()`,
    [JSON.stringify(records)],
  );
  const ids = records.map((record) => record.id);
  // Only managed sample-dataset entries are pruned; other rows may be custom documentation.
  await client.query(`DELETE FROM ${CATALOG_TABLE} WHERE id LIKE 'dataset:%' AND NOT (id = ANY($1::text[]))`, [ids]);
  return result.rowCount ?? 0;
}
