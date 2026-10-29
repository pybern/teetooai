import { describe, expect, it } from "vitest";
import { validateAgentSql } from "./agent-sql";

describe("agent SQL guard", () => {
  it.each([
    ["HKEX aggregate", "SELECT stock_code, sum(short_selling_value) AS v FROM public.insightful_hkex_short_selling WHERE trading_currency = 'HKD' GROUP BY 1 ORDER BY 2 DESC LIMIT 5;", ["public.insightful_hkex_short_selling"]],
    ["sample dataset JSON rows", "SELECT data->>'entity' AS entity, (data->>'gdp')::numeric AS gdp FROM insightful_dataset_rows WHERE dataset_id = 'world-economy'", ["public.insightful_dataset_rows"]],
    ["CTE and window", "WITH x AS (SELECT dataset_id, row_number() OVER (PARTITION BY dataset_id ORDER BY row_index) AS n FROM insightful_dataset_rows) SELECT * FROM x WHERE n < 3", ["public.insightful_dataset_rows"]],
    ["dates", "SELECT extract(year from trading_date) AS y, date_trunc('month', trading_date)::date AS m FROM insightful_hkex_short_selling LIMIT 1", ["public.insightful_hkex_short_selling"]],
    ["registry join", "SELECT d.id, count(*) FROM insightful_datasets d JOIN insightful_dataset_rows r ON r.dataset_id = d.id GROUP BY d.id", ["public.insightful_dataset_rows", "public.insightful_datasets"]],
  ])("accepts %s", async (_, sql, relations) => {
    const result = await validateAgentSql(sql);
    expect(result.relations).toEqual(relations);
    expect(result.sql.endsWith(";")).toBe(false);
  });

  it.each([
    ["configuration table", "SELECT * FROM insightful_configuration", "not in the catalog"],
    ["qualified configuration in subquery", "SELECT (SELECT settings FROM public.insightful_configuration) FROM insightful_datasets", "not in the catalog"],
    ["self-shadowing CTE", "WITH insightful_configuration AS (SELECT * FROM insightful_configuration) SELECT * FROM insightful_configuration", "not in the catalog"],
    ["CTE leaking out of a subquery", "SELECT * FROM (WITH insightful_configuration AS (SELECT 1) SELECT 1) a, insightful_configuration", "not in the catalog"],
    ["system catalog", "SELECT * FROM pg_catalog.pg_user", "not in the catalog"],
    ["information schema", "SELECT * FROM information_schema.tables", "not in the catalog"],
    ["SQL-executing function", "SELECT query_to_xml('select * from insightful_configuration', true, true, '') FROM insightful_datasets", "function query_to_xml"],
    ["file access", "SELECT pg_read_file('/etc/passwd') FROM insightful_datasets", "function pg_read_file"],
    ["sleep", "SELECT pg_sleep(10) FROM insightful_datasets", "function pg_sleep"],
    ["regclass cast", "SELECT 'insightful_configuration'::regclass FROM insightful_datasets", "cast to regclass"],
    ["multiple statements", "SELECT 1 FROM insightful_datasets; DROP TABLE insightful_datasets", "exactly one SELECT"],
    ["writes", "DELETE FROM insightful_datasets", "exactly one SELECT"],
    ["data-modifying CTE", "WITH d AS (DELETE FROM insightful_datasets RETURNING id) SELECT * FROM d", "not allowed"],
    ["row locks", "SELECT * FROM insightful_datasets FOR UPDATE", "row locking"],
    ["select into", "SELECT * INTO copied FROM insightful_datasets", "SELECT INTO"],
    ["no table", "SELECT 1", "at least one"],
    ["syntax", "SELEC * FROM insightful_datasets", "syntax error"],
    ["empty", "  ;  ", "1 to"],
  ])("rejects %s", async (_, sql, message) => {
    await expect(validateAgentSql(sql)).rejects.toThrow(message);
  });
});

describe("agent SQL dataset scope", () => {
  const scope = { datasetIds: ["hk-indices", "hk-valuations"] };
  it("restricts every sample-data reference to the scope's datasets, keeping aliases and HKEX untouched", async () => {
    const result = await validateAgentSql(`SELECT r.data->>'entity' AS e, 'Ünïcode — ok' AS label, d.id, h.stock_code
      FROM public.insightful_dataset_rows r JOIN "insightful_datasets" d ON d.id = r.dataset_id
      CROSS JOIN insightful_hkex_short_selling h
      WHERE r.dataset_id = 'us-macro' AND EXISTS (SELECT 1 FROM INSIGHTFUL_DATASET_ROWS WHERE insightful_dataset_rows.row_index = 0)`, scope);
    const filter = "ANY(ARRAY['hk-indices', 'hk-valuations']::text[])";
    expect(result.executable).toContain(`(SELECT * FROM public.insightful_dataset_rows WHERE dataset_id = ${filter}) r`);
    expect(result.executable).toContain(`(SELECT * FROM public.insightful_datasets WHERE id = ${filter}) d`);
    expect(result.executable).toContain(`(SELECT * FROM public.insightful_dataset_rows WHERE dataset_id = ${filter}) AS insightful_dataset_rows WHERE`);
    expect(result.executable).toContain("CROSS JOIN insightful_hkex_short_selling h");
    expect(result.executable).toContain("'Ünïcode — ok'");
    expect(result.sql).not.toContain("ARRAY[");
    await expect(validateAgentSql(result.executable)).resolves.toBeDefined();
  });
  it("leaves SQL unchanged without a scope and rejects ONLY on scoped tables", async () => {
    const sql = "SELECT * FROM insightful_dataset_rows";
    expect((await validateAgentSql(sql)).executable).toBe(sql);
    await expect(validateAgentSql("SELECT * FROM ONLY insightful_dataset_rows", scope)).rejects.toThrow("ONLY");
  });
});

