import { z } from "zod";
import { HKEX_CHART_METRICS } from "@/lib/hkex-chart";
import type { Insight, InsightSummary, Kpi } from "@/lib/types";
import { ConnectionError } from "./connections";
import type { DatabaseEvidence, HkexQuery } from "./hkex-database";

type Decimal = { coefficient: bigint; scale: number };

function invalidEvidence(): never {
  throw new ConnectionError("Retrieved evidence cannot form valid HKEX insights. Check currencies, dates, stock codes and exact non-negative numeric values.", 502);
}

function decimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) return invalidEvidence();
  const text = String(value);
  if (text.length > 80 || !/^\d+(?:\.\d+)?$/.test(text)) return invalidEvidence();
  const [whole, fraction = ""] = text.split(".");
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}

function storedDate(value: unknown): string {
  if (typeof value !== "string" || !z.iso.date().safeParse(value).success) return invalidEvidence();
  return value;
}

function exact(value: bigint, scale: number): string {
  const digits = (value < BigInt(0) ? -value : value).toString().padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${value < BigInt(0) ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

function percent(numerator: bigint, denominator: bigint): string {
  const scaled = numerator * BigInt(10000);
  const magnitude = scaled < BigInt(0) ? -scaled : scaled;
  const rounded = (magnitude + denominator / BigInt(2)) / denominator;
  return `${exact(scaled < BigInt(0) ? -rounded : rounded, 2)}%`;
}

export function buildHkexInsights(evidence: DatabaseEvidence, query: HkexQuery): InsightSummary {
  const ranking = query.mode === "ranking";
  const ratio = query.metric === "short_turnover_percent";
  const metric = HKEX_CHART_METRICS[query.metric];
  const keys = new Set<string>();
  const parsed = evidence.rows.map((row) => {
    if (row.trading_currency !== query.currency) return invalidEvidence();
    const from = storedDate(row.first_date);
    const to = storedDate(row.last_date);
    if (from > to) return invalidEvidence();
    const date = ranking ? to : storedDate(row.trading_date);
    const code = query.mode === "market-trend" ? "market" : row.stock_code;
    if (typeof code !== "string" || (query.mode !== "market-trend" && !/^\d{5}$/.test(code))) return invalidEvidence();
    if (!ranking && (date !== from || date !== to)) return invalidEvidence();
    const key = JSON.stringify([code, ranking ? null : date]);
    if (keys.has(key)) return invalidEvidence();
    keys.add(key);
    const name = code === "market"
      ? query.stockCodes.length ? "Selected-stock daily total" : "Filtered market daily total"
      : `${code}${typeof row.stock_name === "string" ? ` ${row.stock_name.slice(0, 120)}` : ""}`;
    return { code, name, date, from, to, value: decimal(row[query.metric]) };
  });
  const scale = Math.max(0, ...parsed.map((row) => row.value?.scale ?? 0));
  const rows = parsed.map((row) => ({
    ...row, value: row.value === null ? null : row.value.coefficient * BigInt(10) ** BigInt(scale - row.value.scale),
  }));
  const valueText = (value: bigint | null): string => value === null ? "Unavailable"
    : ratio ? `${exact(value, scale)}%`
      : query.metric === "short_selling_value" ? `${query.currency} ${exact(value, scale)}` : `${exact(value, scale)} shares`;
  const dated = rows.flatMap((row) => [row.from, row.to]).sort();
  const available = rows.filter((row): row is typeof row & { value: bigint } => row.value !== null);
  const missing = rows.length - available.length;
  const kpis: Kpi[] = [];
  const insights: Insight[] = [];
  let headline = "No matching rows were returned; no activity level can be inferred.";
  if (ranking) {
    kpis.push({ label: "Returned stocks", value: String(rows.length) });
    const sorted = [...available].sort((a, b) => a.value === b.value ? a.code.localeCompare(b.code) : a.value > b.value ? -1 : 1);
    const top = sorted[0];
    kpis.push({ label: "Highest returned value", value: valueText(top?.value ?? null), hint: metric });
    if (top) {
      const ties = sorted.filter((row) => row.value === top.value).length;
      headline = `${top.name}${ties > 1 ? ` and ${ties - 1} other returned stock(s) tie for the highest` : " has the highest returned"} ${metric.toLowerCase()}: ${valueText(top.value)}.`;
      insights.push({ kind: "comparison", title: ties > 1 ? "Tied highest values" : "Highest returned stock", text: headline, tone: "neutral" });
    } else if (rows.length) headline = `All ${rows.length} returned ${metric.toLowerCase()} values are unavailable.`;
    if (!ratio && rows.length) {
      const total = missing ? null : available.reduce((sum, row) => sum + row.value, BigInt(0));
      kpis.push({ label: "Returned-stock total", value: valueText(total), hint: "Returned rows only, not a market total" });
      if (top && total !== null && total > BigInt(0) && rows.length > 1) {
        const share = percent(top.value, total);
        kpis.push({ label: "Highest stock's share", value: share, hint: "Share of returned-stock total only" });
        insights.push({ kind: "concentration", title: "Returned-set concentration", text: `${top.name} accounts for ${share} of the ${valueText(total)} total across the ${rows.length} returned stocks. This is not a market share.`, tone: "neutral" });
      }
    }
  } else {
    const dates = new Set(rows.map((row) => row.date));
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.code);
      if (group) group.push(row);
      else groups.set(row.code, [row]);
    }
    kpis.push({ label: "Returned observations", value: String(rows.length) }, { label: "Stored dates", value: String(dates.size), hint: "Not a count of consecutive calendar days" });
    if (groups.size > 1) headline = `${groups.size} separate stock series returned across ${dates.size} stored dates; values are not combined across stocks.`;
    for (const group of groups.values()) {
      group.sort((a, b) => a.date.localeCompare(b.date));
      const first = group[0];
      const last = group.at(-1)!;
      let change = "Change is unavailable: at least two stored observations with valid endpoint values are required.";
      let delta: string | undefined;
      if (group.length > 1 && first.value !== null && last.value !== null) {
        const difference = last.value - first.value;
        delta = ratio ? `${exact(difference, scale)} percentage points`
          : first.value === BigInt(0) ? undefined : percent(difference, first.value);
        change = delta ? `Change from first to last returned observation: ${delta}.`
          : "Percentage change is unavailable because the first returned value is zero.";
      }
      const valid = group.filter((row): row is typeof row & { value: bigint } => row.value !== null);
      const peak = valid.reduce<typeof valid[number] | undefined>((best, row) => !best || row.value > best.value ? row : best, undefined);
      const peakTies = peak ? valid.filter((row) => row.value === peak.value).length : 0;
      const latest = `${first.name}: ${valueText(last.value)} on ${last.date}.`;
      if (groups.size === 1) {
        headline = latest;
        kpis.push({ label: "Latest returned value", value: valueText(last.value), hint: last.date });
        kpis.push({ label: "Change vs first returned", value: delta ?? "Unavailable", hint: `${first.date} to ${last.date}` });
      }
      insights.push({
        kind: "trend", title: first.name, tone: "neutral",
        text: `${latest} ${change} ${peak ? `Highest observed value: ${valueText(peak.value)} on ${peak.date}${peakTies > 1 ? ` (tied across ${peakTies} observations)` : ""}.` : "No valid values are available."}`,
      });
    }
  }
  const warnings = [
    evidence.truncated ? "Only part of the matching data is shown. Findings describe these results, not the full ranking or period." : "",
    missing ? `${missing} value(s) are unavailable; they were not replaced with zero. Totals are unavailable when values are missing.` : "",
    !rows.length ? "No matching data is not evidence of zero activity." : "",
    ratio ? "Ratios are not added or averaged across stocks or dates. Short turnover percentage is not short interest." : "",
    "The data may not include every trading day or the latest activity. Coverage may differ between stocks. Changes and concentrations do not establish causes, forecasts or trading recommendations.",
  ].filter(Boolean).join(" ");
  insights.push({ kind: "caveat", title: "Evidence limits", text: warnings, tone: "warning" });
  return {
    title: `${metric} insights (${query.currency})`,
    headline,
    scope: `${rows.length} results. ${query.currency}${query.board ? ` / ${query.board}` : ""}${query.stockCodes.length ? ` / stocks ${query.stockCodes.join(", ")}` : ""}. Period covered: ${dated[0] ?? "unavailable"} to ${dated.at(-1) ?? "unavailable"}. Shares and percentage changes are rounded to two decimal places.`,
    kpis, insights,
  };
}
