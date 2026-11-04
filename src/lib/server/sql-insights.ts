import type { Insight, InsightSummary, Kpi } from "@/lib/types";
import type { SqlExplanationResult } from "./hkex-explanation";
import { profileColumns, type ColumnProfile } from "./sql-chart";

const IDENTIFIER = /(^|_)(id|code|rank|row_?number)$/i;
const YEAR_NAME = /year|^yr$|^fy$|period/i;

function isYearColumn(column: ColumnProfile, rows: SqlExplanationResult["rows"]): boolean {
  return column.type === "number" && YEAR_NAME.test(column.name) && rows.every((row) => {
    const value = row[column.name];
    if (value === null || value === undefined || value === "") return true;
    const year = Number(value);
    return Number.isInteger(year) && year >= 1800 && year <= 2200;
  });
}

function format(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4 });
}

function pct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

/**
 * Deterministic headline, KPIs and findings for one catalogue SQL result, computed from the
 * returned rows without a model call. Returns null when the rows have no clear axis and measure.
 */
export function buildSqlInsights(result: SqlExplanationResult): InsightSummary | null {
  const { rows } = result;
  if (rows.length < 2) return null;
  const columns = profileColumns(rows);
  const years = new Set(columns.filter((column) => isYearColumn(column, rows)).map((column) => column.name));
  const axis = columns.find((column) => column.type === "date") ?? columns.find((column) => years.has(column.name))
    ?? columns.find((column) => column.type === "text");
  const measure = columns.find((column) => column.type === "number" && column.name !== axis?.name && !years.has(column.name) && !IDENTIFIER.test(column.name));
  if (!axis || !measure) return null;
  const labels = rows.map((row) => String(row[axis.name] ?? "").trim());
  // Repeated axis values mean several series are mixed together; a single summary would mislead.
  if (labels.some((label) => !label) || new Set(labels).size !== labels.length) return null;
  const points = rows.map((row, index) => {
    const raw = row[measure.name];
    return { label: labels[index].slice(0, 120), value: raw === null || raw === undefined || raw === "" ? null : Number(raw) };
  });
  const available = points.filter((point): point is { label: string; value: number } => point.value !== null && Number.isFinite(point.value));
  if (available.length < 2) return null;
  const missing = points.length - available.length;
  const ordered = axis.type === "date" || years.has(axis.name);
  const kpis: Kpi[] = [];
  const insights: Insight[] = [];
  let headline: string;
  if (ordered) {
    const series = [...available].sort((a, b) => years.has(axis.name) ? Number(a.label) - Number(b.label) : a.label.localeCompare(b.label));
    const first = series[0];
    const last = series.at(-1)!;
    const change = last.value - first.value;
    const changePct = first.value !== 0 ? (change / Math.abs(first.value)) * 100 : null;
    const peak = series.reduce((best, point) => point.value > best.value ? point : best);
    const low = series.reduce((best, point) => point.value < best.value ? point : best);
    const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
    headline = `${measure.name} ${direction === "flat" ? "was unchanged" : `moved ${direction}`} from ${format(first.value)} (${first.label}) to ${format(last.value)} (${last.label})${changePct === null ? "" : `, ${pct(changePct)}`}.`;
    kpis.push(
      { label: `Latest ${measure.name}`, value: format(last.value), hint: last.label, spark: series.map((point) => point.value), direction },
      { label: "Change over period", value: `${change > 0 ? "+" : ""}${format(change)}`, ...(changePct === null ? {} : { delta: pct(changePct) }), direction, hint: `${first.label} to ${last.label}` },
      { label: "Peak", value: format(peak.value), hint: peak.label },
      { label: "Low", value: format(low.value), hint: low.label },
    );
    insights.push(
      { kind: "trend", title: "Overall change", text: `From ${first.label} to ${last.label}, ${measure.name} went from ${format(first.value)} to ${format(last.value)}${changePct === null ? "" : ` (${pct(changePct)})`}.`, tone: "neutral" },
      { kind: "peak", title: "Highest point", text: `${measure.name} peaked at ${format(peak.value)} in ${peak.label}.`, tone: "neutral" },
      { kind: "low", title: "Lowest point", text: `${measure.name} was lowest at ${format(low.value)} in ${low.label}.`, tone: "neutral" },
    );
    if (series.length >= 3) {
      const steps = series.slice(1).map((point, index) => ({ from: series[index], to: point, delta: point.value - series[index].value }));
      const biggest = steps.reduce((best, step) => Math.abs(step.delta) > Math.abs(best.delta) ? step : best);
      insights.push({ kind: "momentum", title: "Largest single move", text: `The biggest step was ${biggest.delta > 0 ? "+" : ""}${format(biggest.delta)} between ${biggest.from.label} and ${biggest.to.label}.`, tone: "neutral" });
    }
  } else {
    const sorted = [...available].sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const bottom = sorted.at(-1)!;
    const nonNegative = available.every((point) => point.value >= 0);
    const total = available.reduce((sum, point) => sum + point.value, 0);
    headline = `${top.label} has the highest ${measure.name} among the returned rows at ${format(top.value)}${bottom.value > 0 ? `, ${(top.value / bottom.value).toLocaleString("en-US", { maximumFractionDigits: 1 })}x ${bottom.label}` : ""}.`;
    kpis.push(
      { label: "Returned rows", value: String(rows.length) },
      { label: `Highest ${measure.name}`, value: format(top.value), hint: top.label },
      { label: `Lowest ${measure.name}`, value: format(bottom.value), hint: bottom.label },
      nonNegative
        ? { label: "Returned-row total", value: format(total), hint: "Returned rows only, not a full total" }
        : { label: "Average", value: format(total / available.length), hint: "Returned rows only" },
    );
    insights.push(
      { kind: "peak", title: "Leader", text: `${top.label} leads with ${format(top.value)}.`, tone: "neutral" },
      { kind: "comparison", title: "Spread", text: `The gap between ${top.label} and ${bottom.label} is ${format(top.value - bottom.value)}.`, tone: "neutral" },
    );
    if (nonNegative && total > 0 && available.length >= 3) {
      const leaders = sorted.slice(0, Math.min(3, available.length - 1));
      const share = (leaders.reduce((sum, point) => sum + point.value, 0) / total) * 100;
      insights.push({ kind: "concentration", title: "Concentration", text: `The top ${leaders.length} account for ${share.toLocaleString("en-US", { maximumFractionDigits: 1 })}% of the returned total.`, tone: "neutral" });
    }
  }
  if (missing) insights.push({ kind: "caveat", title: "Missing values", text: `${missing} of ${rows.length} rows have no ${measure.name}; missing values are not zero.`, tone: "warning" });
  if (result.truncated) insights.push({ kind: "caveat", title: "Partial results", text: "More rows matched than were returned, so these figures cover the returned rows only.", tone: "warning" });
  return {
    title: result.title.slice(0, 160),
    headline,
    scope: `${available.length} values of ${measure.name} by ${axis.name} from ${result.tables.join(", ")}. Calculated from the returned rows only.`,
    kpis,
    insights,
  };
}
