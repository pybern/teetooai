import { parse } from "libpg-query";
import { ConnectionError } from "./connections";
import { DATASET_ROWS_RELATION, DATASETS_RELATION, HKEX_RELATION } from "./table-catalog";

export const AGENT_SQL_MAX_CHARS = 4000;

/** Relations the agent may read. The configuration table (API keys) and system catalogs are never allowed. */
export const AGENT_SQL_RELATIONS = new Set([HKEX_RELATION, DATASET_ROWS_RELATION, DATASETS_RELATION].map((name) => name.replace(/^public\./, "")));

const NODE_TYPES = new Set([
  "SelectStmt", "ResTarget", "ColumnRef", "String", "A_Star", "A_Const", "Integer", "Float", "Boolean",
  "TypeCast", "TypeName", "FuncCall", "A_Expr", "BoolExpr", "NullTest", "BooleanTest", "CaseExpr", "CaseWhen",
  "CoalesceExpr", "MinMaxExpr", "SubLink", "RangeVar", "RangeSubselect", "RangeFunction", "JoinExpr", "Alias",
  "SortBy", "WindowDef", "WithClause", "CommonTableExpr", "List", "A_ArrayExpr", "A_Indices", "A_Indirection",
  "RowExpr", "SQLValueFunction", "GroupingSet", "NamedArgExpr",
]);

const FUNCTIONS = new Set([
  // aggregates
  "count", "sum", "avg", "min", "max", "stddev", "stddev_samp", "stddev_pop", "variance", "var_samp", "var_pop",
  "corr", "covar_pop", "covar_samp", "regr_slope", "regr_intercept", "regr_r2", "regr_count", "percentile_cont",
  "percentile_disc", "mode", "string_agg", "array_agg", "jsonb_agg", "json_agg", "jsonb_object_agg", "bool_and", "bool_or", "every",
  // window
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead", "first_value", "last_value", "nth_value",
  // math
  "round", "trunc", "abs", "ceil", "ceiling", "floor", "sign", "sqrt", "power", "exp", "ln", "log", "log10", "mod", "div", "width_bucket",
  // date/time
  "date_trunc", "date_part", "extract", "to_char", "to_date", "make_date", "age", "date_bin", "generate_series", "now", "isfinite",
  // text
  "lower", "upper", "initcap", "left", "right", "length", "char_length", "substring", "substr", "btrim", "ltrim", "rtrim", "trim",
  "concat", "concat_ws", "replace", "split_part", "position", "strpos", "starts_with", "format", "lpad", "rpad", "reverse",
  "regexp_replace", "regexp_match", "to_number",
  // json/array
  "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_each", "jsonb_each_text", "jsonb_object_keys", "jsonb_typeof",
  "jsonb_array_length", "jsonb_build_object", "jsonb_extract_path_text", "array_length", "cardinality", "unnest", "array_to_string",
]);

const TYPES = new Set([
  "text", "varchar", "bpchar", "numeric", "int2", "int4", "int8", "integer", "bigint", "smallint", "float4", "float8",
  "real", "double", "date", "timestamp", "timestamptz", "interval", "bool", "boolean", "jsonb", "json",
]);

/** Limits sample-data reads to a use case's datasets; null allows every catalogued dataset. */
export type AgentDataScope = { datasetIds: string[] | null };
export type ValidatedAgentSql = { sql: string; relations: string[]; executable: string };
type RelationUse = { name: string; location: number; aliased: boolean; inherit: boolean };
const SCOPED_RELATIONS: Record<string, string> = {
  insightful_dataset_rows: "dataset_id",
  insightful_datasets: "id",
};

function reject(message: string): never {
  throw new ConnectionError(`SQL rejected: ${message}`, 400);
}

function names(list: unknown): string[] {
  return Array.isArray(list) ? list.map((item) => (item as { String?: { sval?: string } })?.String?.sval ?? "") : [];
}

function walk(node: unknown, scope: Set<string>, relations: RelationUse[]) {
  if (Array.isArray(node)) { for (const item of node) walk(item, scope, relations); return; }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (/^[A-Z]/.test(key)) {
      if (!NODE_TYPES.has(key)) reject(`${key} is not allowed. Use a single read-only SELECT.`);
      const body = value as Record<string, unknown>;
      if (key === "SelectStmt") {
        if (body.intoClause) reject("SELECT INTO is not allowed.");
        if (body.lockingClause) reject("row locking is not allowed.");
        const { withClause, ...rest } = body as { withClause?: { recursive?: boolean; ctes?: unknown[] } };
        const inner = new Set(scope);
        if (withClause) {
          const ctes = (withClause.ctes ?? []).map((item) => {
            const cte = (item as { CommonTableExpr?: { ctename?: string; ctequery?: unknown } }).CommonTableExpr;
            if (!cte?.ctename) reject("invalid WITH clause.");
            return cte as { ctename: string; ctequery?: unknown };
          });
          // A non-recursive CTE sees only earlier siblings, so its own name still resolves to a real table inside its body.
          if (withClause.recursive) for (const cte of ctes) inner.add(cte.ctename);
          for (const cte of ctes) {
            walk(cte.ctequery, new Set(inner), relations);
            inner.add(cte.ctename);
          }
        }
        walk(rest, inner, relations);
        continue;
      }
      if (key === "RangeVar") {
        const relation = body as { catalogname?: string; schemaname?: string; relname?: string; location?: number; alias?: unknown; inh?: boolean };
        if (relation.catalogname) reject("cross-database references are not allowed.");
        const name = relation.relname ?? "";
        if (!relation.schemaname && scope.has(name)) continue;
        if ((relation.schemaname && relation.schemaname !== "public") || !AGENT_SQL_RELATIONS.has(name)) {
          reject(`table ${relation.schemaname ? `${relation.schemaname}.` : ""}${name} is not in the catalog. Allowed: ${[...AGENT_SQL_RELATIONS].map((item) => `public.${item}`).join(", ")}.`);
        }
        relations.push({ name, location: relation.location ?? -1, aliased: Boolean(relation.alias), inherit: relation.inh === true });
        continue;
      }
      if (key === "FuncCall") {
        const parts = names(body.funcname);
        const name = parts.at(-1) ?? "";
        if ((parts.length > 1 && parts[0] !== "pg_catalog") || parts.length > 2 || !FUNCTIONS.has(name)) reject(`function ${parts.join(".")} is not allowed.`);
      }
      if (key === "TypeCast") {
        const parts = names((body.typeName as { names?: unknown } | undefined)?.names);
        if (parts.length > 2 || (parts.length > 1 && parts[0] !== "pg_catalog") || !TYPES.has(parts.at(-1) ?? "")) {
          reject(`cast to ${parts.join(".")} is not allowed.`);
        }
      }
      if (key === "A_Const" || key === "String") continue;
    }
    walk(value, scope, relations);
  }
}

function quoteList(values: string[]) {
  return `ARRAY[${values.map((value) => {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new ConnectionError("Invalid dataset scope.", 500);
    return `'${value}'`;
  }).join(", ")}]::text[]`;
}

/** Replaces each sample-data table reference with a subquery restricted to the scope's datasets. */
function applyScope(sql: string, relations: RelationUse[], scope: AgentDataScope) {
  if (!scope.datasetIds) return sql;
  // Parser locations are byte offsets, so splice UTF-8 bytes rather than JS string indices.
  let output = Buffer.from(sql, "utf8");
  const scoped = relations.filter((item) => SCOPED_RELATIONS[item.name]).sort((a, b) => b.location - a.location);
  for (const use of scoped) {
    if (!use.inherit) reject("ONLY is not supported for sample-data tables.");
    const rest = use.location >= 0 ? output.subarray(use.location).toString("utf8") : "";
    const match = new RegExp(`^(?:(?:public|"public")\\s*\\.\\s*)?(?:${use.name}|"${use.name}")(?![A-Za-z0-9_$"])`, "i").exec(rest);
    if (!match) reject(`could not scope ${use.name}; reference it as public.${use.name}.`);
    const filtered = `(SELECT * FROM public.${use.name} WHERE ${SCOPED_RELATIONS[use.name]} = ANY(${quoteList(scope.datasetIds)}))${use.aliased ? "" : ` AS ${use.name}`}`;
    output = Buffer.concat([output.subarray(0, use.location), Buffer.from(filtered, "utf8"), output.subarray(use.location + Buffer.byteLength(match[0]))]);
  }
  return output.toString("utf8");
}

export async function validateAgentSql(input: unknown, scope: AgentDataScope = { datasetIds: null }): Promise<ValidatedAgentSql> {
  if (typeof input !== "string") reject("provide SQL text.");
  const sql = input.trim().replace(/;\s*$/, "").trim();
  if (!sql || sql.length > AGENT_SQL_MAX_CHARS) reject(`SQL must be 1 to ${AGENT_SQL_MAX_CHARS} characters.`);
  if (sql.includes("\0")) reject("SQL contains a null character.");
  let tree: { stmts?: { stmt?: Record<string, unknown> }[] };
  try { tree = await parse(sql); } catch (error) {
    reject(`syntax error${error instanceof Error && error.message ? ` (${error.message.slice(0, 200)})` : ""}.`);
  }
  if (tree.stmts?.length !== 1 || !tree.stmts[0].stmt || Object.keys(tree.stmts[0].stmt)[0] !== "SelectStmt") reject("use exactly one SELECT statement.");
  const relations: RelationUse[] = [];
  walk(tree.stmts[0].stmt, new Set(), relations);
  if (!relations.length) reject("query at least one catalogued table.");
  return { sql, relations: [...new Set(relations.map((item) => `public.${item.name}`))].sort(), executable: applyScope(sql, relations, scope) };
}
