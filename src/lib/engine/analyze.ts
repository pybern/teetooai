import { DATASETS, DATASET_BY_ID } from "../data";
import type {
  ChartDatum,
  ChartSpec,
  Dataset,
  Insight,
  InsightReport,
  Interpretation,
  Kpi,
  MetricDef,
  NumberFormat,
  Row,
  TableSpec,
} from "../types";
import { fmt, listJoin, multiple, pct, points } from "./format";
import {
  cagr,
  correlationLabel,
  exponentialFit,
  linearFit,
  mean,
  median,
  pctChange,
  pearson,
  round,
  stdev,
  sum,
  zScores,
  logisticFit,
  type Fit,
} from "./stats";

export const PALETTE = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c", "#4ade80", "#e879f9"];
const POS = "#34d399";
const NEG = "#f87171";
const MUTED = "#475569";

type Draft = Omit<InsightReport, "id" | "createdAt" | "question" | "useCaseId" | "interpretation" | "source" | "asOf" | "steps"> & {
  steps?: string[];
};

type Point = { x: number; label: string; value: number };

const EVENTS: Record<string, string> = {
  "2008": "the global financial crisis",
  "2009": "the global financial crisis",
  "2020": "the COVID-19 pandemic",
  "2021": "the post-pandemic reopening",
  "2022": "the global inflation shock and rate hikes",
  "2022-03": "the Omicron wave and Shanghai lockdown",
  "2022-10": "the Hong Kong sell-off to a 13-year low",
  "2022-11": "China's reopening rally",
  "2023-01": "China's reopening rally",
  "2024-09": "Beijing's stimulus rally",
  "2025-04": "the US tariff shock",
};

// ---------- helpers ----------

const num = (r: Row, key: string): number | undefined => (typeof r[key] === "number" ? (r[key] as number) : undefined);

function metric(ds: Dataset, key: string): MetricDef {
  return ds.metrics.find((m) => m.key === key) ?? ds.metrics[0];
}

/** Lowercase a label for mid-sentence use while keeping acronyms such as GDP, P/E, CO₂ and EV. */
export function lc(label: string): string {
  return label
    .split(" ")
    .map((w) => (/[A-Z].*[A-Z]|\/|₂|^[A-Z]$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function plural(word: string, n = 2): string {
  if (n === 1) return word;
  if (/index$/i.test(word)) return word.replace(/ex$/i, "ices");
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

const EVENT_DATASETS = /^(us-macro|hk-|big-tech)/;

/** Metrics whose changes are read as point differences (rates, shares, temperature anomalies), not percent changes. */
function isPercentLike(m: MetricDef): boolean {
  const suffix = m.format.suffix?.trim();
  return suffix === "%" || suffix === "°C";
}

function pointSuffix(m: MetricDef): string {
  return m.format.suffix?.trim() === "°C" ? "°C" : " pts";
}

function grainWord(ds: Dataset): { unit: string; change: string; units: string } {
  return ds.grain === "month" ? { unit: "month", change: "MoM", units: "months" } : { unit: "year", change: "YoY", units: "years" };
}

function periodLabel(r: Row): string {
  return r.label ?? String(r.year);
}

let eventScope: { grain?: string; enabled: boolean } = { enabled: false };

function eventFor(x: number): string | undefined {
  if (!eventScope.enabled) return undefined;
  const y = Math.floor(x + 1e-6);
  if (eventScope.grain !== "month") return EVENTS[String(y)];
  const m = Math.round((x - y) * 12) + 1;
  return EVENTS[`${y}-${String(m).padStart(2, "0")}`] ?? EVENTS[String(y)];
}

function inWindow(year: number, it: Interpretation): boolean {
  if (it.yearFrom !== undefined && year < it.yearFrom - 1e-6) return false;
  if (it.yearTo !== undefined && year >= it.yearTo + 1 - 1e-6) return false;
  return true;
}

function series(ds: Dataset, key: string, it: Interpretation, entity?: string): Point[] {
  const from = it.yearFrom ?? (it.intent === "trend" || it.intent === "anomaly" ? it.year : undefined);
  const scoped = { ...it, yearFrom: from };
  return ds.rows
    .filter((r) => (entity ? r.entity === entity : true) && typeof r.year === "number" && num(r, key) !== undefined)
    .filter((r) => inWindow(r.year as number, scoped))
    .sort((a, b) => (a.year as number) - (b.year as number))
    .map((r) => ({ x: r.year as number, label: periodLabel(r), value: num(r, key) as number }));
}

/** Latest (or requested-year) value per entity. */
function snapshotRows(ds: Dataset, key: string, it: Interpretation): { entity: string; value: number; row: Row; label?: string }[] {
  if (ds.kind === "cross-section") {
    return ds.rows
      .filter((r) => r.entity && num(r, key) !== undefined)
      .map((r) => ({ entity: r.entity as string, value: num(r, key) as number, row: r }));
  }
  if (ds.kind === "timeseries") {
    return series(ds, key, it).map((p) => ({ entity: p.label, value: p.value, row: { year: p.x }, label: p.label }));
  }
  const byEntity = new Map<string, Row>();
  for (const r of ds.rows) {
    if (!r.entity || num(r, key) === undefined || typeof r.year !== "number") continue;
    if (it.year !== undefined && Math.floor(r.year) !== it.year) continue;
    const cur = byEntity.get(r.entity);
    if (!cur || (cur.year as number) < r.year) byEntity.set(r.entity, r);
  }
  return [...byEntity.values()].map((r) => ({ entity: r.entity as string, value: num(r, key) as number, row: r, label: periodLabel(r) }));
}

function changeOf(m: MetricDef, from: number, to: number): { text: string; value: number; isPoints: boolean } {
  if (isPercentLike(m)) {
    const text = pointSuffix(m) === " pts" ? points(to - from, m.format.decimals ?? 1) : fmt(to - from, { prefix: "+", suffix: pointSuffix(m), decimals: m.format.decimals ?? 1 });
    return { text, value: to - from, isPoints: true };
  }
  const p = pctChange(from, to);
  if (p > 400 && from > 0) return { text: multiple(to / from), value: p, isPoints: false };
  return { text: pct(p), value: p, isPoints: false };
}

function direction(v: number): "up" | "down" | "flat" {
  return Math.abs(v) < 1e-9 ? "flat" : v > 0 ? "up" : "down";
}

function goodness(m: MetricDef, delta: number): boolean | undefined {
  if (m.higherIsBetter === undefined) return undefined;
  return m.higherIsBetter ? delta >= 0 : delta <= 0;
}

function spanYears(pts: Point[]): number {
  return pts.length > 1 ? pts[pts.length - 1].x - pts[0].x : 0;
}

function spanText(pts: Point[]): string {
  return pts.length ? `${pts[0].label}–${pts[pts.length - 1].label}` : "";
}

function sampleSpark(values: number[], n = 24): number[] {
  if (values.length <= n) return values;
  const step = (values.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => values[Math.round(i * step)]);
}

function cell(v: number | undefined, d = 4): number | null {
  return v === undefined || !Number.isFinite(v) ? null : round(v, d);
}

function entityColor(ds: Dataset, name: string): string {
  const idx = ds.entities?.findIndex((e) => e.name === name) ?? -1;
  return PALETTE[(idx >= 0 ? idx : Math.abs(hash(name))) % PALETTE.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function rangeSql(it: Interpretation, timeCol = "year"): string {
  const parts: string[] = [];
  if (it.yearFrom !== undefined) parts.push(`${timeCol} >= ${Math.floor(it.yearFrom)}`);
  if (it.yearTo !== undefined) parts.push(`${timeCol} <= ${it.yearTo}`);
  return parts.join(" AND ");
}

function tableName(ds: Dataset): string {
  return ds.id.replace(/-/g, "_");
}

function entityList(names: string[]): string {
  return names.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");
}

// ---------- intents ----------

function trend(ds: Dataset, it: Interpretation): Draft {
  const g = grainWord(ds);
  const entity = ds.kind === "panel" ? it.entities[0] ?? defaultEntity(ds, it.metrics[0]) : undefined;
  const metricKeys = it.metrics.slice(0, 2);
  const m = metric(ds, metricKeys[0]);
  const pts = series(ds, m.key, it, entity);
  if (pts.length < 2) return empty(ds, "Not enough data points in the selected range.");

  const first = pts[0];
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a));
  const low = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const total = changeOf(m, first.value, last.value);
  const recent = changeOf(m, prev.value, last.value);
  const years = spanYears(pts);
  const growth = !isPercentLike(m) && years >= 1.5 ? cagr(first.value, last.value, years) : NaN;
  const subject = subjectFor(entity, m);

  const kpis: Kpi[] = [
    {
      label: `Latest (${last.label})`,
      value: fmt(last.value, m.format),
      delta: `${recent.text} ${g.change}`,
      direction: direction(recent.value),
      good: goodness(m, recent.value),
      spark: sampleSpark(pts.map((p) => p.value)),
    },
    {
      label: `Change since ${first.label}`,
      value: total.text,
      delta: `from ${fmt(first.value, m.format)}`,
      direction: direction(total.value),
      good: goodness(m, total.value),
    },
    Number.isFinite(growth)
      ? { label: "Annualized growth (CAGR)", value: pct(growth), direction: direction(growth), good: goodness(m, growth), hint: `${years.toFixed(1)} years` }
      : { label: "Average", value: fmt(mean(pts.map((p) => p.value)), m.format), hint: `over ${pts.length} ${g.units}` },
    { label: `Peak (${peak.label})`, value: fmt(peak.value, m.format), delta: `Low ${fmt(low.value, m.format)} (${low.label})`, direction: "flat" },
  ];

  const changes = pts.slice(1).map((p, i) => ({
    label: p.label,
    x: p.x,
    change: isPercentLike(m) ? p.value - pts[i].value : pctChange(pts[i].value, p.value),
  }));
  const changeFormat: NumberFormat = isPercentLike(m) ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 };
  const biggestUp = changes.reduce((a, b) => (b.change > a.change ? b : a));
  const biggestDown = changes.reduce((a, b) => (b.change < a.change ? b : a));

  const charts: ChartSpec[] = [];
  if (metricKeys.length === 2) {
    const m2 = metric(ds, metricKeys[1]);
    const pts2 = new Map(series(ds, m2.key, it, entity).map((p) => [p.label, p.value]));
    const sameUnit = JSON.stringify(m.format) === JSON.stringify(m2.format);
    charts.push({
      id: "trend",
      type: "composed",
      title: `${m.label} and ${lc(m2.label)}${entity ? ` — ${entity}` : ""}`,
      subtitle: spanText(pts),
      data: pts.map((p) => ({ label: p.label, [m.key]: p.value, [m2.key]: pts2.get(p.label) ?? null })),
      xKey: "label",
      series: [
        { key: m.key, label: m.label, kind: ds.grain === "month" ? "area" : "bar", color: PALETTE[0], format: m.format },
        { key: m2.key, label: m2.label, kind: "line", color: PALETTE[1], axis: sameUnit ? "left" : "right", format: m2.format },
      ],
      format: m.format,
      rightFormat: sameUnit ? undefined : m2.format,
      span: "full",
    });
  } else {
    charts.push({
      id: "trend",
      type: "area",
      title: cap(subject),
      subtitle: `${spanText(pts)} · ${pts.length} ${g.units}`,
      data: pts.map((p) => ({ label: p.label, [m.key]: p.value })),
      xKey: "label",
      series: [{ key: m.key, label: m.label, color: entity ? entityColor(ds, entity) : PALETTE[0], format: m.format }],
      format: m.format,
      referenceY: [{ value: round(mean(pts.map((p) => p.value)), 3), label: "Average" }],
      referenceX: [{ value: peak.label, label: "Peak" }],
      span: "full",
    });
  }
  charts.push({
    id: "changes",
    type: "bar",
    title: `${g.change} change`,
    subtitle: isPercentLike(m) ? "Percentage-point change" : "Percent change",
    data: changes.map((c) => ({
      label: c.label,
      change: round(c.change, 3),
      __color: (m.higherIsBetter === false ? c.change <= 0 : c.change >= 0) ? POS : NEG,
    })),
    xKey: "label",
    series: [{ key: "change", label: `${g.change} change`, format: changeFormat }],
    format: changeFormat,
    colorByKey: "__color",
    span: "half",
  });
  const sortedPeriods = [...pts].sort((a, b) => b.value - a.value).slice(0, 8);
  charts.push({
    id: "ranked-periods",
    type: "hbar",
    title: `Highest ${g.unit}s`,
    subtitle: `Top ${sortedPeriods.length} by ${lc(m.label)}`,
    data: sortedPeriods.map((p) => ({ label: p.label, value: p.value, __color: p.label === last.label ? PALETTE[3] : PALETTE[0] })),
    xKey: "label",
    series: [{ key: "value", label: m.label, format: m.format }],
    format: m.format,
    colorByKey: "__color",
    span: "half",
  });

  const insights: Insight[] = [];
  const dirWord = total.value > 0 ? "rose" : total.value < 0 ? "fell" : "was flat";
  insights.push({
    kind: "trend",
    title: `${cap(subject)} ${dirWord} ${total.text.endsWith("×") ? total.text : total.isPoints ? total.text.replace("+", "").replace("−", "") : pct(Math.abs(total.value)).replace("+", "")} over the period`,
    text: `From ${fmt(first.value, m.format)} in ${first.label} to ${fmt(last.value, m.format)} in ${last.label}${Number.isFinite(growth) ? `, a compound annual rate of ${pct(growth)}` : ""}.`,
    tone: toneFor(m, total.value),
  });
  const fromPeak = changeOf(m, peak.value, last.value);
  insights.push({
    kind: "peak",
    title: peak.label === last.label ? `${last.label} is the high of the period` : `Peak in ${peak.label}`,
    text:
      peak.label === last.label
        ? `The latest reading of ${fmt(last.value, m.format)} is the highest in the selected window.`
        : `${subject} topped out at ${fmt(peak.value, m.format)} in ${peak.label}; the latest value is ${fromPeak.text.replace("−", "").replace("+", "")} ${fromPeak.value < 0 ? "below" : "above"} that peak.${eventFor(peak.x) ? ` The peak coincides with ${eventFor(peak.x)}.` : ""}`,
    tone: "neutral",
  });
  insights.push({
    kind: "anomaly",
    title: `Sharpest move: ${biggestUp.change >= Math.abs(biggestDown.change) ? biggestUp.label : biggestDown.label}`,
    text: `The biggest ${g.unit}ly rise was ${fmt(biggestUp.change, changeFormat)} in ${biggestUp.label}${eventFor(biggestUp.x) ? ` (${eventFor(biggestUp.x)})` : ""}; ${biggestDown.change < 0 ? `the biggest drop was ${fmt(biggestDown.change, changeFormat)} in ${biggestDown.label}${eventFor(biggestDown.x) ? ` (${eventFor(biggestDown.x)})` : ""}` : `it never declined — the smallest gain was ${fmt(biggestDown.change, changeFormat)} in ${biggestDown.label}`}.`,
    tone: "warning",
  });
  const k = Math.min(ds.grain === "month" ? 6 : 3, Math.floor(pts.length / 2));
  if (k >= 2) {
    const recentAvg = mean(pts.slice(-k).map((p) => p.value));
    const priorAvg = mean(pts.slice(-2 * k, -k).map((p) => p.value));
    const mo = changeOf(m, priorAvg, recentAvg);
    insights.push({
      kind: "momentum",
      title: `Momentum: ${mo.value > 0 ? "accelerating upward" : mo.value < 0 ? "cooling" : "steady"}`,
      text: `The last ${k} ${g.units} averaged ${fmt(recentAvg, m.format)}, ${mo.text} versus the ${k} ${g.units} before.`,
      tone: toneFor(m, mo.value),
    });
  }

  return {
    title: `${cap(subject)}: ${spanText(pts)}`,
    headline: `${cap(subject)} ${dirWord === "was flat" ? "was flat" : `${dirWord} from ${fmt(first.value, m.format)} to ${fmt(last.value, m.format)}`} between ${first.label} and ${last.label} (${total.text}), peaking at ${fmt(peak.value, m.format)} in ${peak.label}.`,
    kpis,
    charts,
    insights,
    table: {
      columns: [
        { key: "period", label: ds.grain === "month" ? "Month" : "Year" },
        ...metricKeys.map((k2) => ({ key: k2, label: metric(ds, k2).label, format: metric(ds, k2).format, align: "right" as const })),
        { key: "change", label: `${g.change}`, format: changeFormat, align: "right" as const },
      ],
      rows: pts.map((p, i) => {
        const row: ChartDatum = { period: p.label, [m.key]: p.value, change: i ? cell(changes[i - 1].change) : null };
        if (metricKeys[1]) row[metricKeys[1]] = series(ds, metricKeys[1], it, entity).find((q) => q.label === p.label)?.value ?? null;
        return row;
      }),
    },
    sql: `SELECT ${ds.grain === "month" ? "month" : "year"}, ${metricKeys.join(", ")}\nFROM ${tableName(ds)}${entity || rangeSql(it) ? `\nWHERE ${[entity ? `${(ds.entityLabel ?? "entity").toLowerCase()} = '${entity}'` : "", rangeSql(it)].filter(Boolean).join(" AND ")}` : ""}\nORDER BY ${ds.grain === "month" ? "month" : "year"};`,
    followUps: [
      `Forecast ${entity ? `${entity} ` : ""}${lc(m.label)} to ${Math.floor(last.x) + (ds.grain === "month" ? 1 : 3)}`,
      `Detect anomalies in ${entity ? `${entity} ` : ""}${lc(m.label)}`,
      ds.kind === "panel" ? `Rank by ${lc(m.label)}` : ds.metrics.length > 1 ? `${m.label} vs ${ds.metrics.find((x) => x.key !== m.key)?.label.toLowerCase()}` : `${m.label} since ${Math.floor(last.x) - 5}`,
    ],
  };
}

function subjectFor(entity: string | undefined, m: MetricDef): string {
  if (!entity) return lc(m.label);
  if (m.key === "level" || m.key === "indexed") return entity;
  return `${entity} ${lc(m.label)}`;
}

function toneFor(m: MetricDef, delta: number): Insight["tone"] {
  const good = goodness(m, delta);
  if (good === undefined || Math.abs(delta) < 1e-9) return "neutral";
  return good ? "positive" : "negative";
}

function defaultEntity(ds: Dataset, key: string): string | undefined {
  const snap = snapshotRows(ds, key, { intent: "rank" } as Interpretation).sort((a, b) => b.value - a.value);
  return ds.id === "hk-indices" ? ds.entities?.[0]?.name : snap[0]?.entity;
}

function rank(ds: Dataset, it: Interpretation): Draft {
  const m = metric(ds, it.metrics[0]);
  const all = snapshotRows(ds, m.key, it);
  const excluded = (ds.entities ?? []).map((e) => e.name).filter((n) => ds.kind !== "timeseries" && !all.some((a) => a.entity === n));
  if (!all.length) return empty(ds, `No ${lc(m.label)} values available.`);
  const sorted = [...all].sort((a, b) => (it.order === "asc" ? a.value - b.value : b.value - a.value));
  const n = it.topN ?? (sorted.length > 12 ? 10 : sorted.length);
  const top = sorted.slice(0, n);
  const leader = top[0];
  const second = top[1];
  const values = all.map((a) => a.value);
  const totalAll = sum(values);
  const hasNegative = values.some((v) => v < 0);
  const summable = !!m.summable && !hasNegative;
  const periodNote = ds.kind === "panel" ? ` (${it.year ?? "latest"}${ds.id.includes("tech") || ds.id.includes("financials") ? " fiscal year" : ""})` : ds.kind === "cross-section" ? ` (${ds.asOf})` : "";
  const isTimeRank = ds.kind === "timeseries";
  const label = isTimeRank ? (ds.grain === "month" ? "month" : "year") : (ds.entityLabel ?? "entity").toLowerCase();
  const superl = it.order === "asc" ? "lowest" : "highest";

  const kpis: Kpi[] = [
    { label: `${it.order === "asc" ? "Lowest" : "Highest"} ${label}`, value: leader.entity, delta: fmt(leader.value, m.format), direction: "flat" },
  ];
  if (second) {
    const ratio = leader.value / second.value;
    kpis.push(
      summable && ratio > 1.15 && it.order === "desc"
        ? { label: `#1 vs #2 (${second.entity})`, value: multiple(ratio), hint: `${fmt(second.value, m.format)} for #2` }
        : { label: `Gap to #2 (${second.entity})`, value: fmt(Math.abs(leader.value - second.value), { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix }), hint: `${fmt(second.value, m.format)} for #2` },
    );
  }
  if (summable && !isTimeRank) {
    const topShare = (sum(top.map((t) => t.value)) / totalAll) * 100;
    kpis.push({ label: `Top ${top.length} share of total`, value: `${topShare.toFixed(1)}%`, hint: `of ${fmt(totalAll, m.format)} across ${all.length}` });
  } else {
    kpis.push({ label: "Median", value: fmt(median(values), m.format), hint: `across ${all.length} ${plural(label)}` });
  }
  if (hasNegative) {
    kpis.push({ label: "Positive vs negative", value: `${values.filter((v) => v >= 0).length} / ${values.filter((v) => v < 0).length}`, hint: `${plural(label)} up / down` });
  } else {
    kpis.push({ label: "Spread", value: fmt(Math.max(...values) - Math.min(...values), { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix }), hint: `${fmt(Math.min(...values), m.format)} to ${fmt(Math.max(...values), m.format)}` });
  }

  const charts: ChartSpec[] = [
    {
      id: "rank",
      type: "hbar",
      title: `${it.order === "asc" ? "Bottom" : "Top"} ${top.length} by ${lc(m.label)}${periodNote}`,
      subtitle: ds.name,
      data: top.map((t, i) => ({
        label: t.entity,
        value: t.value,
        __color: hasNegative ? (t.value >= 0 ? POS : NEG) : i === 0 ? PALETTE[3] : it.entities.includes(t.entity) ? PALETTE[1] : PALETTE[0],
      })),
      xKey: "label",
      series: [{ key: "value", label: m.label, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "full",
    },
  ];

  if (summable && !isTimeRank) {
    const others = totalAll - sum(top.map((t) => t.value));
    charts.push({
      id: "share",
      type: "donut",
      title: /^share of /i.test(m.label) ? cap(lc(m.label)) : `Share of total ${lc(m.label)}`,
      subtitle: `${top.length} shown + others`,
      data: [
        ...top.slice(0, 8).map((t, i) => ({ label: t.entity, value: round(t.value, 3), __color: PALETTE[i % PALETTE.length] })),
        ...(top.length > 8 || others > 1e-9
          ? [{ label: "Others", value: round(others + sum(top.slice(8).map((t) => t.value)), 3), __color: MUTED }]
          : []),
      ],
      xKey: "label",
      series: [{ key: "value", label: m.label, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    });
  } else {
    const med = median(values);
    charts.push({
      id: "vs-median",
      type: "bar",
      title: `Distance from median (${fmt(med, m.format)})`,
      subtitle: `All ${all.length} ${plural(label)}`,
      data: [...all]
        .sort((a, b) => b.value - a.value)
        .map((a) => ({ label: a.entity, diff: round(a.value - med, 3), __color: a.value >= med === (m.higherIsBetter !== false) ? POS : NEG })),
      xKey: "label",
      series: [{ key: "diff", label: "vs median", format: { ...m.format, prefix: m.format.prefix === "$" || m.format.prefix === "HK$" ? m.format.prefix : "+" } }],
      format: { ...m.format, prefix: m.format.prefix === "+" ? "+" : m.format.prefix },
      colorByKey: "__color",
      span: "half",
    });
  }

  if (ds.kind === "panel") {
    const ents = top.slice(0, 5).map((t) => t.entity);
    charts.push(multiLine(ds, m, ents, it, `${m.label} history — top ${ents.length}`, m.rebaseOnCompare));
  } else if (ds.kind === "cross-section" && ds.metrics.length > 1) {
    const other = ds.metrics.find((x) => x.key !== m.key) as MetricDef;
    charts.push({
      id: "context",
      type: "scatter",
      title: `${m.label} vs ${lc(other.label)}`,
      subtitle: `Each dot is a ${label}; top ${top.length} highlighted`,
      data: ds.rows
        .filter((r) => num(r, m.key) !== undefined && num(r, other.key) !== undefined)
        .map((r) => ({ label: r.entity as string, x: num(r, other.key) as number, y: num(r, m.key) as number, __color: top.some((t) => t.entity === r.entity) ? PALETTE[3] : PALETTE[0] })),
      xKey: "x",
      series: [
        { key: "x", label: other.label, format: other.format },
        { key: "y", label: m.label, format: m.format },
      ],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    });
  }

  const insights: Insight[] = [];
  insights.push({
    kind: "comparison",
    title: `${leader.entity} ranks #1 for ${superl} ${lc(m.label)}`,
    text: `${leader.entity} comes in at ${fmt(leader.value, m.format)}${second ? `, ahead of ${second.entity} (${fmt(second.value, m.format)})` : ""}${top[2] ? ` and ${top[2].entity} (${fmt(top[2].value, m.format)})` : ""}.`,
    tone: "neutral",
  });
  if (summable && !isTimeRank && all.length >= 4) {
    const desc = [...all].sort((a, b) => b.value - a.value);
    const top3 = (sum(desc.slice(0, 3).map((t) => t.value)) / totalAll) * 100;
    insights.push({
      kind: "concentration",
      title: top3 > 50 ? "Highly concentrated" : "Broadly distributed",
      text: `The top three (${listJoin(desc.slice(0, 3).map((d) => d.entity))}) account for ${top3.toFixed(1)}% of the total across all ${all.length} ${plural(label)}.`,
      tone: top3 > 50 ? "warning" : "neutral",
    });
  }
  const med = median(values);
  const aboveMedian = top.filter((t) => (it.order === "asc" ? t.value < med : t.value > med)).length;
  if (!isTimeRank) {
    const tail = sorted[sorted.length - 1];
    insights.push({
      kind: "low",
      title: `${it.order === "asc" ? "Highest" : "Lowest"}: ${tail.entity}`,
      text: `At the other end, ${tail.entity} has ${fmt(tail.value, m.format)}${tailGap(leader.value, tail.value, m)}. The median is ${fmt(med, m.format)}${aboveMedian && aboveMedian < top.length ? `; ${aboveMedian} of the ${top.length} shown sit on the ${it.order === "asc" ? "low" : "high"} side of it` : ""}.`,
      tone: "neutral",
    });
  }
  if (hasNegative) {
    const losers = values.filter((v) => v < 0).length;
    insights.push({
      kind: "momentum",
      title: `${values.length - losers} up, ${losers} down`,
      text: `${values.length - losers} of ${values.length} ${plural(label)} are positive. Average: ${fmt(mean(values), m.format)}.`,
      tone: losers > values.length / 2 ? "negative" : "positive",
    });
  }
  if (excluded.length) {
    insights.push({
      kind: "caveat",
      title: `${excluded.length} excluded`,
      text: `${listJoin(excluded)} ${excluded.length === 1 ? "has" : "have"} no ${lc(m.label)} value${m.key.toLowerCase().includes("pe") ? " (typically because earnings are negative)" : ""} and ${excluded.length === 1 ? "is" : "are"} left out of the ranking.`,
      tone: "warning",
    });
  }

  const tbl: TableSpec = {
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "entity", label: isTimeRank ? (ds.grain === "month" ? "Month" : "Year") : ds.entityLabel ?? "Entity" },
      { key: "value", label: m.label, format: m.format, align: "right" },
      ...(summable && !isTimeRank ? [{ key: "share", label: "Share", format: { suffix: "%", decimals: 1 }, align: "right" as const }] : []),
    ],
    rows: sorted.map((s, i) => ({ rank: i + 1, entity: s.entity, value: s.value, share: summable ? cell((s.value / totalAll) * 100) : null })),
  };

  return {
    title: `${it.order === "asc" ? "Lowest" : "Top"} ${plural(label)} by ${lc(m.label)}`,
    headline: `${leader.entity} has the ${superl} ${lc(m.label)} at ${fmt(leader.value, m.format)}${second ? `, followed by ${second.entity} at ${fmt(second.value, m.format)}` : ""}.`,
    kpis,
    charts,
    insights,
    table: tbl,
    sql: `SELECT ${isTimeRank ? "year" : (ds.entityLabel ?? "entity").toLowerCase()}, ${m.key}\nFROM ${tableName(ds)}${ds.kind === "panel" ? `\nWHERE year = ${it.year ?? "(SELECT MAX(year) FROM " + tableName(ds) + ")"}` : ""}${m.key.toLowerCase().includes("pe") ? `\n  AND ${m.key} IS NOT NULL` : ""}\nORDER BY ${m.key} ${it.order.toUpperCase()}\nLIMIT ${top.length};`,
    followUps: [
      ds.groupAttrs?.length ? `Break down ${lc(m.label)} by ${lc(ds.groupAttrs[0].label)}` : `Share of ${lc(m.label)}`,
      second ? `Compare ${leader.entity} and ${second.entity}` : `${m.label} trend`,
      ds.kind === "panel" ? `Which ${label} grew ${lc(m.label)} fastest?` : ds.metrics.length > 1 ? `Relationship between ${lc(m.label)} and ${ds.metrics.find((x) => x.key !== m.key)?.label.toLowerCase()}` : `${leader.entity} ${lc(m.label)}`,
    ],
  };
}

function tailGap(a: number, b: number, m: MetricDef): string {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo > 0 && hi / lo >= 1.5) return ` — the leader's value is ${multiple(hi / lo)} ${a > b ? "higher" : "lower"}`;
  return ` — ${fmt(Math.abs(a - b), { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix, suffix: isPercentLike(m) ? " pts" : m.format.suffix })} from the leader`;
}

function multiLine(ds: Dataset, m: MetricDef, entities: string[], it: Interpretation, title: string, rebase?: boolean): ChartSpec {
  const all = entities.map((e) => ({ e, pts: series(ds, m.key, { ...it, year: undefined }, e) }));
  const labels = [...new Map(all.flatMap((a) => a.pts.map((p) => [p.label, p.x] as const))).entries()].sort((a, b) => a[1] - b[1]);
  const commonStart = Math.max(...all.map((a) => a.pts[0]?.x ?? -Infinity));
  const data = labels
    .filter(([, x]) => !rebase || x >= commonStart - 1e-6)
    .map(([label]) => {
      const d: ChartDatum = { label };
      for (const a of all) {
        const p = a.pts.find((q) => q.label === label);
        const base = a.pts.find((q) => Math.abs(q.x - commonStart) < 1e-6)?.value;
        d[a.e] = p ? (rebase && base ? round((p.value / base) * 100, 2) : p.value) : null;
      }
      return d;
    });
  const f: NumberFormat = rebase ? { decimals: 0 } : m.format;
  return {
    id: "multi",
    type: "line",
    title,
    subtitle: rebase ? `Rebased to 100 at ${data[0]?.label ?? "start"}` : spanText(all[0]?.pts ?? []),
    data,
    xKey: "label",
    series: all.map((a) => ({ key: a.e, label: a.e, color: entityColor(ds, a.e), format: f })),
    format: f,
    referenceY: rebase ? [{ value: 100, label: "Start" }] : undefined,
    span: "half",
  };
}

function share(ds: Dataset, it: Interpretation): Draft {
  const m = metric(ds, it.metrics[0]);
  const rows = snapshotRows(ds, m.key, it).filter((r) => r.value > 0);
  if (!rows.length) return empty(ds, "No positive values available for a breakdown.");
  const group = it.groupBy ? ds.groupAttrs?.find((g) => g.key === it.groupBy) : undefined;
  const summable = !!m.summable;
  const total = sum(rows.map((r) => r.value));

  type Part = { name: string; value: number; members: string[] };
  let parts: Part[];
  if (group) {
    const map = new Map<string, Part>();
    for (const r of rows) {
      const gname = String(r.row[group.key] ?? "Other");
      const p = map.get(gname) ?? { name: gname, value: 0, members: [] };
      p.value += r.value;
      p.members.push(r.entity);
      map.set(gname, p);
    }
    parts = [...map.values()];
    if (!summable) parts = parts.map((p) => ({ ...p, value: p.value / p.members.length }));
  } else {
    parts = rows.map((r) => ({ name: r.entity, value: r.value, members: [r.entity] }));
  }
  parts.sort((a, b) => b.value - a.value);
  const partTotal = sum(parts.map((p) => p.value));
  const shareOf = (v: number) => (summable ? (v / partTotal) * 100 : NaN);
  const hhi = summable ? sum(parts.map((p) => (shareOf(p.value) / 100) ** 2)) : NaN;
  const groupColors = new Map(parts.map((p, i) => [p.name, PALETTE[i % PALETTE.length]]));
  const what = group ? lc(group.label) : (ds.entityLabel ?? "entity").toLowerCase();
  const ofTotal = /^share of /i.test(m.label) ? `of ${lc(m.label).replace(/^share of /, "")}` : `of total ${lc(m.label)}`;
  const valueNote = (v: number) => (isPercentLike(m) ? "" : ` (${fmt(v, m.format)})`);
  const periodNote = ds.kind === "panel" ? ` · ${it.year ?? "latest year"}` : ` · ${ds.asOf}`;

  const kpis: Kpi[] = [
    { label: `Largest ${what}`, value: parts[0].name, delta: summable ? `${shareOf(parts[0].value).toFixed(1)}% of total` : fmt(parts[0].value, m.format), direction: "flat" },
    summable && parts.length === 2
      ? { label: `${parts[1].name} share`, value: `${shareOf(parts[1].value).toFixed(1)}%`, direction: "flat" }
      : summable
      ? { label: "Top 2 combined", value: `${(shareOf(parts[0].value) + shareOf(parts[1]?.value ?? 0)).toFixed(1)}%`, hint: listJoin(parts.slice(0, 2).map((p) => p.name)) }
      : { label: `Smallest ${what}`, value: parts[parts.length - 1].name, delta: fmt(parts[parts.length - 1].value, m.format), direction: "flat" },
    summable ? { label: "Total", value: fmt(total, m.format), hint: `${rows.length} ${plural((ds.entityLabel ?? "item").toLowerCase())}` } : { label: "Average", value: fmt(mean(parts.map((p) => p.value)), m.format) },
    summable
      ? { label: "Concentration (HHI)", value: hhi.toFixed(2), hint: hhi > 0.25 ? "Highly concentrated" : hhi > 0.15 ? "Moderately concentrated" : "Diversified" }
      : { label: `${cap(plural(what))}`, value: String(parts.length) },
  ];

  const charts: ChartSpec[] = [
    summable
      ? {
          id: "donut",
          type: "donut",
          title: `${m.label} by ${what}`,
          subtitle: `${ds.name}${periodNote}`,
          data: parts.slice(0, 10).map((p) => ({ label: p.name, value: round(p.value, 3), __color: groupColors.get(p.name) })).concat(
            parts.length > 10 ? [{ label: "Others", value: round(sum(parts.slice(10).map((p) => p.value)), 3), __color: MUTED }] : [],
          ),
          xKey: "label",
          series: [{ key: "value", label: m.label, format: m.format }],
          format: m.format,
          colorByKey: "__color",
          span: "half",
        }
      : {
          id: "avg",
          type: "bar",
          title: `Average ${lc(m.label)} by ${what}`,
          subtitle: `${ds.name}${periodNote}`,
          data: parts.map((p) => ({ label: p.name, value: round(p.value, 3), __color: groupColors.get(p.name) })),
          xKey: "label",
          series: [{ key: "value", label: m.label, format: m.format }],
          format: m.format,
          colorByKey: "__color",
          span: "half",
        },
    {
      id: "treemap",
      type: "treemap",
      title: group ? `${ds.entityLabel ?? "Items"} sized by ${lc(m.label)}, colored by ${what}` : `${m.label} treemap`,
      subtitle: "Area proportional to value",
      data: rows
        .sort((a, b) => b.value - a.value)
        .map((r) => ({
          label: r.entity,
          value: round(r.value, 3),
          group: group ? String(r.row[group.key]) : r.entity,
          __color: group ? groupColors.get(String(r.row[group.key])) : groupColors.get(r.entity),
        })),
      xKey: "label",
      series: [{ key: "value", label: m.label, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    },
  ];
  if (summable) {
    charts.push({
      id: "share-bars",
      type: "hbar",
      title: `Share of total by ${what}`,
      subtitle: "Percent of total",
      data: parts.map((p) => ({ label: p.name, share: round(shareOf(p.value), 2), __color: groupColors.get(p.name) })),
      xKey: "label",
      series: [{ key: "share", label: "Share", format: { suffix: "%", decimals: 1 } }],
      format: { suffix: "%", decimals: 1 },
      colorByKey: "__color",
      span: "full",
    });
  }

  const insights: Insight[] = [
    {
      kind: "share",
      title: `${parts[0].name} dominates`,
      text: summable
        ? `${parts[0].name} accounts for ${shareOf(parts[0].value).toFixed(1)}% ${ofTotal}${valueNote(parts[0].value)}${group && parts[0].members.length > 1 ? ` across ${parts[0].members.length} members led by ${listJoin(parts[0].members.slice(0, 3))}` : ""}.`
        : `${parts[0].name} has the highest average ${lc(m.label)} at ${fmt(parts[0].value, m.format)}.`,
      tone: "neutral",
    },
  ];
  if (parts.length > 2) {
    const tail = parts[parts.length - 1];
    insights.push({
      kind: "low",
      title: `Smallest: ${tail.name}`,
      text: summable ? `${tail.name} contributes just ${shareOf(tail.value).toFixed(1)}%${valueNote(tail.value)}.` : `${tail.name} averages ${fmt(tail.value, m.format)}.`,
      tone: "neutral",
    });
  }
  if (summable) {
    insights.push({
      kind: "concentration",
      title: hhi > 0.25 ? "Highly concentrated mix" : hhi > 0.15 ? "Moderately concentrated mix" : "Diversified mix",
      text: `The Herfindahl–Hirschman index is ${hhi.toFixed(2)} (1.0 = a single ${what}). ${parts.length >= 3 ? `The top three ${plural(what)} make up ${(shareOf(parts[0].value) + shareOf(parts[1].value) + shareOf(parts[2].value)).toFixed(1)}%.` : ""}`,
      tone: hhi > 0.25 ? "warning" : "neutral",
    });
  }
  if (group) {
    for (const p of parts.slice(0, 2)) {
      if (p.members.length > 1) {
        insights.push({
          kind: "comparison",
          title: `Inside ${p.name}`,
          text: `${p.members.length} ${plural((ds.entityLabel ?? "member").toLowerCase(), p.members.length)}: ${listJoin(p.members)}.`,
          tone: "neutral",
        });
      }
    }
  }

  return {
    title: `${m.label} breakdown by ${what}`,
    headline: summable
      ? `${parts[0].name} is the largest ${what} with ${shareOf(parts[0].value).toFixed(1)}% ${ofTotal}${parts[1] ? `, followed by ${parts[1].name} at ${shareOf(parts[1].value).toFixed(1)}%` : ""}.`
      : `${parts[0].name} has the highest average ${lc(m.label)} (${fmt(parts[0].value, m.format)}).`,
    kpis,
    charts,
    insights,
    table: {
      columns: [
        { key: "name", label: group ? group.label : ds.entityLabel ?? "Entity" },
        { key: "value", label: summable ? m.label : `Avg ${lc(m.label)}`, format: m.format, align: "right" },
        ...(summable ? [{ key: "share", label: "Share", format: { suffix: "%", decimals: 1 }, align: "right" as const }] : []),
        ...(group ? [{ key: "members", label: "Members" }] : []),
      ],
      rows: parts.map((p) => ({ name: p.name, value: cell(p.value), share: summable ? cell(shareOf(p.value)) : null, members: p.members.join(", ") })),
    },
    sql: group
      ? `SELECT ${group.key}, ${summable ? "SUM" : "AVG"}(${m.key}) AS ${m.key},\n       ${summable ? "SUM" : "AVG"}(${m.key}) * 100.0 / SUM(SUM(${m.key})) OVER () AS share_pct\nFROM ${tableName(ds)}\nGROUP BY ${group.key}\nORDER BY ${m.key} DESC;`
      : `SELECT ${(ds.entityLabel ?? "entity").toLowerCase()}, ${m.key},\n       ${m.key} * 100.0 / SUM(${m.key}) OVER () AS share_pct\nFROM ${tableName(ds)}${ds.kind === "panel" ? `\nWHERE year = ${it.year ?? `(SELECT MAX(year) FROM ${tableName(ds)})`}` : ""}\nORDER BY ${m.key} DESC;`,
    followUps: [
      `Top 5 by ${lc(m.label)}`,
      group ? `${m.label} by ${(ds.entityLabel ?? "entity").toLowerCase()}` : ds.groupAttrs?.length ? `${m.label} by ${lc(ds.groupAttrs[0].label)}` : `Compare ${parts[0].name} and ${parts[1]?.name ?? parts[0].name}`,
      parts[1] ? `Compare ${(group ? parts[0].members[0] : parts[0].name)} and ${(group ? parts[1].members[0] : parts[1].name)}` : `${m.label} trend`,
    ],
  };
}

function compare(ds: Dataset, it: Interpretation): Draft {
  if (ds.kind === "cross-section") return compareCross(ds, it);
  const m = metric(ds, it.metrics[0]);
  const ents = it.entities.slice(0, 6);
  const rebase = !!m.rebaseOnCompare;
  const rebased = rebase || m.key === "indexed";
  const perEntity = ents.map((e) => ({ e, pts: series(ds, m.key, { ...it, year: undefined }, e) })).filter((x) => x.pts.length >= 1);
  if (perEntity.length < 2) return empty(ds, "Need at least two entities with data to compare.");
  const commonStart = Math.max(...perEntity.map((p) => p.pts[0].x));
  const stats = perEntity.map(({ e, pts }) => {
    const fromPt = pts.find((p) => Math.abs(p.x - commonStart) < 1e-6) ?? pts[0];
    const last = pts[pts.length - 1];
    const yrs = last.x - fromPt.x;
    return {
      e,
      first: fromPt,
      last,
      change: changeOf(m, fromPt.value, last.value),
      cagr: !isPercentLike(m) && yrs >= 1 ? cagr(fromPt.value, last.value, yrs) : NaN,
      pts,
    };
  });
  const byLatest = [...stats].sort((a, b) => b.last.value - a.last.value);
  const byChange = [...stats].sort((a, b) => b.change.value - a.change.value);
  const lead = byLatest[0];
  const runner = byLatest[1];

  const kpis: Kpi[] = stats.slice(0, 4).map((s) => ({
    label: s.e,
    value: fmt(s.last.value, m.format),
    delta: `${s.change.text} since ${s.first.label}`,
    direction: direction(s.change.value),
    good: goodness(m, s.change.value),
    spark: sampleSpark(s.pts.map((p) => p.value)),
  }));

  const line = multiLine(ds, m, stats.map((s) => s.e), it, rebase ? `Relative performance (rebased to 100)` : rebased ? `Total return (start = 100)` : `${m.label} over time`, rebase);
  line.span = "full";
  const charts: ChartSpec[] = [line];
  if (ds.grain !== "month") {
    const years = [...new Set(stats.flatMap((s) => s.pts.map((p) => p.label)))].sort();
    charts.push({
      id: "grouped",
      type: "bar",
      title: `${m.label} by year`,
      subtitle: "Grouped by entity",
      data: years.map((y) => {
        const d: ChartDatum = { label: y };
        for (const s of stats) d[s.e] = s.pts.find((p) => p.label === y)?.value ?? null;
        return d;
      }),
      xKey: "label",
      series: stats.map((s) => ({ key: s.e, label: s.e, color: entityColor(ds, s.e), format: m.format })),
      format: m.format,
      span: "half",
    });
  }
  charts.push({
    id: "change",
    type: "hbar",
    title: rebase ? `Total return since ${stats[0].first.label}` : `Change since ${stats[0].first.label}`,
    subtitle: isPercentLike(m) ? "Percentage points" : "Percent",
    data: byChange.map((s) => ({ label: s.e, change: round(s.change.value, 2), __color: s.change.value >= 0 ? POS : NEG })),
    xKey: "label",
    series: [{ key: "change", label: "Change", format: isPercentLike(m) ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 } }],
    format: isPercentLike(m) ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 },
    colorByKey: "__color",
    span: "half",
  });

  const insights: Insight[] = [];
  insights.push({
    kind: "comparison",
    title: rebased ? `${lead.e} is the best performer` : `${lead.e} leads on ${lc(m.label)}`,
    text: rebased
      ? `${lead.e} ends at ${fmt(lead.last.value, { decimals: 0 })} on a rebased scale (start = 100), versus ${runner.e} at ${fmt(runner.last.value, { decimals: 0 })}.`
      : `As of ${lead.last.label}, ${lead.e} is at ${fmt(lead.last.value, m.format)} versus ${runner.e} at ${fmt(runner.last.value, m.format)}${runner.last.value > 0 && lead.last.value / runner.last.value > 1.2 ? ` — ${multiple(lead.last.value / runner.last.value)} larger` : ""}.`,
    tone: "neutral",
  });
  insights.push({
    kind: "trend",
    title: `${byChange[0].e} ${byChange[0].change.value >= 0 ? "grew" : "fell"} the ${byChange[0].change.value >= 0 ? "most" : "least"}`,
    text: `Since ${byChange[0].first.label}: ${byChange.map((s) => `${s.e} ${s.change.text}${Number.isFinite(s.cagr) && ds.grain !== "month" ? ` (CAGR ${pct(s.cagr)})` : ""}`).join(", ")}.`,
    tone: toneFor(m, byChange[0].change.value),
  });
  if (stats.length === 2) {
    const [a, b] = stats;
    const labels = a.pts.filter((p) => b.pts.some((q) => q.label === p.label));
    let crosses = 0;
    let lastCross = "";
    for (let i = 1; i < labels.length; i++) {
      const pa = labels[i - 1];
      const pb = labels[i];
      const ba = b.pts.find((q) => q.label === pa.label)!.value;
      const bb = b.pts.find((q) => q.label === pb.label)!.value;
      const da = rebase ? pa.value / a.first.value - ba / b.first.value : pa.value - ba;
      const db = rebase ? pb.value / a.first.value - bb / b.first.value : pb.value - bb;
      if (Math.sign(da) !== Math.sign(db) && da !== 0) {
        crosses++;
        lastCross = pb.label;
      }
    }
    const gapStart = a.first.value - b.first.value;
    const gapEnd = a.last.value - b.last.value;
    insights.push({
      kind: "momentum",
      title: crosses ? `Lead changed hands ${crosses} time${crosses > 1 ? "s" : ""}` : `${Math.abs(gapEnd) > Math.abs(gapStart) ? "Gap widened" : "Gap narrowed"}`,
      text: crosses
        ? `The two lines crossed ${crosses} time${crosses > 1 ? "s" : ""}, most recently in ${lastCross}.`
        : rebase
          ? `${a.e} returned ${a.change.text} versus ${b.e} at ${b.change.text} — a ${Math.abs(a.change.value - b.change.value).toFixed(1)}-point performance gap.`
          : `The gap between ${a.e} and ${b.e} moved from ${fmt(Math.abs(gapStart), { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix, suffix: isPercentLike(m) ? " pts" : m.format.suffix })} to ${fmt(Math.abs(gapEnd), { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix, suffix: isPercentLike(m) ? " pts" : m.format.suffix })}.`,
      tone: "neutral",
    });
  }
  const vols = stats
    .filter((s) => s.pts.length > 3)
    .map((s) => ({ e: s.e, vol: stdev(s.pts.slice(1).map((p, i) => pctChange(s.pts[i].value, p.value))) }));
  if (vols.length >= 2 && ds.grain === "month") {
    vols.sort((x, y) => y.vol - x.vol);
    insights.push({
      kind: "anomaly",
      title: `${vols[0].e} is the most volatile`,
      text: `Monthly return volatility: ${vols.map((v) => `${v.e} ${v.vol.toFixed(1)}%`).join(", ")}.`,
      tone: "warning",
    });
  }

  return {
    title: `${listJoin(stats.map((s) => s.e))}: ${lc(m.label)}`,
    headline: rebased
      ? `Since ${stats[0].first.label}, ${byChange[0].e} has returned ${byChange[0].change.text} versus ${listJoin(byChange.slice(1).map((s) => `${s.e} (${s.change.text})`))}.`
      : `${lead.e} leads with ${fmt(lead.last.value, m.format)} in ${lead.last.label}; ${byChange[0].e} ${byChange[0].change.value >= 0 ? "grew fastest" : "declined least"} (${byChange[0].change.text} since ${byChange[0].first.label}).`,
    kpis,
    charts,
    insights,
    table: {
      columns: [
        { key: "entity", label: ds.entityLabel ?? "Entity" },
        { key: "first", label: `${stats[0].first.label}`, format: m.format, align: "right" },
        { key: "last", label: `Latest`, format: m.format, align: "right" },
        { key: "change", label: "Change", format: isPercentLike(m) ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 }, align: "right" },
        ...(ds.grain !== "month" ? [{ key: "cagr", label: "CAGR", format: { prefix: "+", suffix: "%", decimals: 1 }, align: "right" as const }] : []),
      ],
      rows: stats.map((s) => ({ entity: s.e, first: s.first.value, last: s.last.value, change: cell(s.change.value), cagr: cell(s.cagr) })),
    },
    sql: `SELECT ${ds.grain === "month" ? "month" : "year"}, ${(ds.entityLabel ?? "entity").toLowerCase()}, ${m.key}${rebase ? `,\n       100.0 * ${m.key} / FIRST_VALUE(${m.key}) OVER (PARTITION BY ${(ds.entityLabel ?? "entity").toLowerCase()} ORDER BY ${ds.grain === "month" ? "month" : "year"}) AS rebased` : ""}\nFROM ${tableName(ds)}\nWHERE ${(ds.entityLabel ?? "entity").toLowerCase()} IN (${entityList(stats.map((s) => s.e))})${rangeSql(it) ? ` AND ${rangeSql(it)}` : ""}\nORDER BY 1, 2;`,
    followUps: [
      ...stats.slice(0, 2).map((s) => `${s.e} ${ds.metrics.find((x) => x.key !== m.key)?.label.toLowerCase() ?? lc(m.label)} trend`),
      `Rank all by ${lc(m.label)}`,
    ],
  };
}

function compareCross(ds: Dataset, it: Interpretation): Draft {
  const ents = it.entities.slice(0, 6);
  const metrics = it.metrics.map((k) => metric(ds, k));
  const rows = ents.map((e) => ds.rows.find((r) => r.entity === e)).filter((r): r is Row => !!r);
  if (rows.length < 2) return empty(ds, "Need at least two entities to compare.");
  const m0 = metrics[0];

  const rankOf = (key: string, e: string) => {
    const vals = ds.rows.filter((r) => num(r, key) !== undefined).sort((a, b) => (num(b, key) as number) - (num(a, key) as number));
    return { pos: vals.findIndex((r) => r.entity === e) + 1, of: vals.length };
  };

  const kpis: Kpi[] = rows.slice(0, 4).map((r) => {
    const rk = rankOf(m0.key, r.entity as string);
    return { label: r.entity as string, value: fmt(num(r, m0.key), m0.format), hint: `${m0.label} · #${rk.pos} of ${rk.of}` };
  });

  const charts: ChartSpec[] = [];
  if (metrics.length >= 3) {
    charts.push({
      id: "radar",
      type: "radar",
      title: "Profile comparison",
      subtitle: "Each axis scaled to the dataset maximum (100 = highest)",
      data: metrics.map((m) => {
        const max = Math.max(...ds.rows.map((r) => Math.abs(num(r, m.key) ?? 0)));
        const d: ChartDatum = { label: m.short ?? m.label };
        for (const r of rows) d[r.entity as string] = max ? round(((num(r, m.key) ?? 0) / max) * 100, 1) : 0;
        return d;
      }),
      xKey: "label",
      series: rows.map((r) => ({ key: r.entity as string, label: r.entity as string, color: entityColor(ds, r.entity as string), format: { decimals: 0 } })),
      format: { decimals: 0 },
      span: "full",
    });
  }
  for (const m of metrics.slice(0, 4)) {
    charts.push({
      id: `m-${m.key}`,
      type: "bar",
      title: m.label,
      data: rows.map((r) => ({ label: r.entity as string, value: num(r, m.key) ?? null, __color: entityColor(ds, r.entity as string) })),
      xKey: "label",
      series: [{ key: "value", label: m.label, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    });
  }

  const insights: Insight[] = metrics.slice(0, 4).map((m) => {
    const sorted = [...rows].filter((r) => num(r, m.key) !== undefined).sort((a, b) => (num(b, m.key) as number) - (num(a, m.key) as number));
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const ratio = top && bottom && (num(bottom, m.key) as number) > 0 ? (num(top, m.key) as number) / (num(bottom, m.key) as number) : NaN;
    return {
      kind: "comparison",
      title: `${m.label}: ${top?.entity} leads`,
      text: `${sorted.map((r) => `${r.entity} ${fmt(num(r, m.key), m.format)}`).join(" · ")}${Number.isFinite(ratio) && ratio > 1.5 ? ` — a ${multiple(ratio)} spread.` : "."}`,
      tone: "neutral",
    };
  });

  return {
    title: `${listJoin(rows.map((r) => r.entity as string))} compared`,
    headline: crossHeadline(rows, metrics),
    kpis,
    charts,
    insights,
    table: {
      columns: [{ key: "entity", label: ds.entityLabel ?? "Entity" }, ...metrics.map((m) => ({ key: m.key, label: m.label, format: m.format, align: "right" as const }))],
      rows: rows.map((r) => Object.fromEntries([["entity", r.entity], ...metrics.map((m) => [m.key, num(r, m.key) ?? null])])),
    },
    sql: `SELECT ${(ds.entityLabel ?? "entity").toLowerCase()}, ${metrics.map((m) => m.key).join(", ")}\nFROM ${tableName(ds)}\nWHERE ${(ds.entityLabel ?? "entity").toLowerCase()} IN (${entityList(rows.map((r) => r.entity as string))});`,
    followUps: [`Top 10 by ${lc(m0.label)}`, ds.groupAttrs?.length ? `${m0.label} by ${lc(ds.groupAttrs[0].label)}` : `Share of ${lc(m0.label)}`, `${rows[0].entity} profile`],
  };
}

function crossHeadline(rows: Row[], metrics: MetricDef[]): string {
  const parts = metrics.slice(0, 3).map((m) => {
    const sorted = rows.filter((r) => num(r, m.key) !== undefined).sort((a, b) => (num(b, m.key) as number) - (num(a, m.key) as number));
    return { m, top: sorted[0], second: sorted[1] };
  });
  const [first, ...rest] = parts;
  const lead = `${first.top.entity} leads on ${lc(first.m.label)} (${fmt(num(first.top, first.m.key), first.m.format)} vs ${fmt(num(first.second, first.m.key), first.m.format)} for ${first.second.entity})`;
  return rest.length ? `${lead}; on ${listJoin(rest.map((p) => `${lc(p.m.label)} it's ${p.top.entity}`))}.` : `${lead}.`;
}

function correlation(ds: Dataset, it: Interpretation): Draft {
  const [mx, my] = it.metrics.slice(0, 2).map((k) => metric(ds, k));
  type Obs = { label: string; x: number; y: number; t?: number };
  let obs: Obs[];
  if (ds.kind === "timeseries") {
    obs = ds.rows
      .filter((r) => num(r, mx.key) !== undefined && num(r, my.key) !== undefined && inWindow(r.year as number, it))
      .map((r) => ({ label: periodLabel(r), x: num(r, mx.key) as number, y: num(r, my.key) as number, t: r.year as number }));
  } else if (ds.kind === "cross-section") {
    obs = ds.rows
      .filter((r) => num(r, mx.key) !== undefined && num(r, my.key) !== undefined)
      .map((r) => ({ label: r.entity as string, x: num(r, mx.key) as number, y: num(r, my.key) as number }));
  } else {
    obs = ds.rows
      .filter((r) => num(r, mx.key) !== undefined && num(r, my.key) !== undefined && (!it.entities.length || it.entities.includes(r.entity as string)))
      .map((r) => ({ label: `${r.entity} ${periodLabel(r)}`, x: num(r, mx.key) as number, y: num(r, my.key) as number, t: r.year as number }));
  }
  if (obs.length < 3) return empty(ds, "Need at least three paired observations.");
  const xs = obs.map((o) => o.x);
  const ys = obs.map((o) => o.y);
  const r = pearson(xs, ys);
  const fit = linearFit(xs, ys);
  const residuals = obs.map((o) => ({ o, res: o.y - fit.predict(o.x) })).sort((a, b) => Math.abs(b.res) - Math.abs(a.res));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  const charts: ChartSpec[] = [
    {
      id: "scatter",
      type: "scatter",
      title: `${my.label} vs ${lc(mx.label)}`,
      subtitle: `r = ${r.toFixed(2)} · ${obs.length} observations · dashed line = least-squares fit`,
      data: obs.map((o) => ({ label: o.label, x: o.x, y: o.y, __color: residuals.slice(0, 3).some((q) => q.o === o) ? PALETTE[3] : PALETTE[0] })),
      xKey: "x",
      series: [
        { key: "x", label: mx.label, format: mx.format },
        { key: "y", label: my.label, format: my.format },
      ],
      format: my.format,
      colorByKey: "__color",
      highlightKey: JSON.stringify({ x1: minX, y1: fit.predict(minX), x2: maxX, y2: fit.predict(maxX) }),
      span: ds.kind === "cross-section" ? "full" : "half",
    },
  ];
  if (ds.kind === "timeseries") {
    const same = JSON.stringify(mx.format) === JSON.stringify(my.format);
    charts.push({
      id: "dual",
      type: "composed",
      title: "Both series over time",
      subtitle: same ? "Shared axis" : "Dual axis",
      data: obs.map((o) => ({ label: o.label, [mx.key]: o.x, [my.key]: o.y })),
      xKey: "label",
      series: [
        { key: mx.key, label: mx.label, kind: "area", color: PALETTE[0], format: mx.format },
        { key: my.key, label: my.label, kind: "line", color: PALETTE[1], axis: same ? "left" : "right", format: my.format },
      ],
      format: mx.format,
      rightFormat: same ? undefined : my.format,
      span: "half",
    });
  } else {
    charts.push({
      id: "ratio",
      type: "hbar",
      title: `${my.short ?? my.label} relative to fit`,
      subtitle: "Residual from the regression line (above = higher than expected)",
      data: residuals.slice(0, 12).map((q) => ({ label: q.o.label, res: round(q.res, 3), __color: q.res >= 0 ? POS : NEG })),
      xKey: "label",
      series: [{ key: "res", label: "Residual", format: { ...my.format, prefix: "+" } }],
      format: { ...my.format, prefix: "+" },
      colorByKey: "__color",
      span: "full",
    });
  }

  let lagInsight: Insight | null = null;
  if (ds.kind === "timeseries" && obs.length > 6) {
    const lead = pearson(xs.slice(0, -1), ys.slice(1));
    const lag = pearson(xs.slice(1), ys.slice(0, -1));
    const best = Math.abs(lead) > Math.abs(lag) ? { r: lead, who: mx.label, other: my.label } : { r: lag, who: my.label, other: mx.label };
    if (Math.abs(best.r) > Math.abs(r) + 0.05) {
      lagInsight = {
        kind: "correlation",
        title: `Stronger with a one-${grainWord(ds).unit} lag`,
        text: `When ${lc(best.who)} leads ${lc(best.other)} by one ${grainWord(ds).unit}, the correlation rises to ${best.r.toFixed(2)} (from ${r.toFixed(2)}) — consistent with a delayed response.`,
        tone: "positive",
      };
    }
  }

  const insights: Insight[] = [
    {
      kind: "correlation",
      title: `${correlationLabel(r)[0].toUpperCase()}${correlationLabel(r).slice(1)} relationship (r = ${r.toFixed(2)})`,
      text: `${(fit.r2 * 100).toFixed(0)}% of the variation in ${lc(my.label)} is explained by ${lc(mx.label)} in a simple linear model.`,
      tone: Math.abs(r) >= 0.6 ? "positive" : "neutral",
    },
    {
      kind: "trend",
      title: "Sensitivity",
      text: `On average, a ${fmt(1, { ...mx.format, prefix: mx.format.prefix === "+" ? "" : mx.format.prefix, decimals: 0 })} higher ${lc(mx.label)} goes with ${fit.slope >= 0 ? "a higher" : "a lower"} ${lc(my.label)} of about ${fmt(Math.abs(fit.slope), { ...my.format, prefix: my.format.prefix === "+" ? "" : my.format.prefix, decimals: Math.max(2, my.format.decimals ?? 1) })}.`,
      tone: "neutral",
    },
    {
      kind: "anomaly",
      title: `Biggest outliers: ${listJoin(residuals.slice(0, 2).map((q) => q.o.label))}`,
      text: residuals
        .slice(0, 3)
        .map((q) => `${q.o.label} is ${fmt(Math.abs(q.res), { ...my.format, prefix: my.format.prefix === "+" ? "" : my.format.prefix })} ${q.res > 0 ? "above" : "below"} the fit`)
        .join("; ") + ".",
      tone: "warning",
    },
  ];
  if (lagInsight) insights.push(lagInsight);
  insights.push({
    kind: "caveat",
    title: "Correlation is not causation",
    text: `With ${obs.length} observations, treat this as descriptive. Shared drivers (policy, business cycle, sector mix) can move both variables together.`,
    tone: "warning",
  });

  return {
    title: `${mx.label} vs ${lc(my.label)}`,
    headline: `${mx.label} and ${lc(my.label)} show a ${correlationLabel(r)} correlation (r = ${r.toFixed(2)}, R² = ${fit.r2.toFixed(2)}) across ${obs.length} ${ds.kind === "timeseries" ? grainWord(ds).units : "observations"}.`,
    kpis: [
      { label: "Pearson r", value: r.toFixed(2), hint: correlationLabel(r), direction: direction(r) },
      { label: "R²", value: fit.r2.toFixed(2), hint: "Variance explained" },
      { label: "Slope", value: fit.slope.toFixed(3), hint: `${my.short ?? my.label} per unit ${mx.short ?? mx.label}` },
      { label: "Observations", value: String(obs.length), hint: ds.kind === "timeseries" ? spanText(obs.map((o) => ({ x: o.t ?? 0, label: o.label, value: 0 }))) : ds.entityLabel ? plural(ds.entityLabel.toLowerCase()) : "" },
    ],
    charts,
    insights,
    table: {
      columns: [
        { key: "label", label: ds.kind === "timeseries" ? "Period" : ds.entityLabel ?? "Entity" },
        { key: "x", label: mx.label, format: mx.format, align: "right" },
        { key: "y", label: my.label, format: my.format, align: "right" },
        { key: "fit", label: "Fitted", format: my.format, align: "right" },
      ],
      rows: obs.map((o) => ({ label: o.label, x: o.x, y: o.y, fit: cell(fit.predict(o.x)) })),
    },
    sql: `SELECT CORR(${mx.key}, ${my.key}) AS r,\n       REGR_SLOPE(${my.key}, ${mx.key}) AS slope,\n       REGR_R2(${my.key}, ${mx.key}) AS r2,\n       COUNT(*) AS n\nFROM ${tableName(ds)}${rangeSql(it) ? `\nWHERE ${rangeSql(it)}` : ""};`,
    followUps: [`${mx.label} trend`, `${my.label} trend`, ds.kind === "timeseries" ? `Detect anomalies in ${lc(my.label)}` : `Top 10 by ${lc(my.label)}`],
  };
}

function forecast(ds: Dataset, it: Interpretation): Draft {
  const m = metric(ds, it.metrics[0]);
  const entity = ds.kind === "panel" ? it.entities[0] ?? defaultEntity(ds, m.key) : undefined;
  const pts = series(ds, m.key, { ...it, year: undefined }, entity);
  if (pts.length < 3) return empty(ds, "Need at least three data points to forecast.");
  const last = pts[pts.length - 1];
  const step = ds.grain === "month" ? 1 / 12 : 1;
  const target = it.targetYear ?? Math.floor(last.x) + (ds.grain === "month" ? 1 : 3);
  const targetX = ds.grain === "month" ? target + 11 / 12 : target;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.value);
  const lin = linearFit(xs, ys);
  const ceiling = m.ceiling ?? (isPercentLike(m) && /share/i.test(m.key) ? 100 : undefined);
  const logi = ceiling !== undefined ? logisticFit(xs, ys, ceiling) : null;
  const exp = ceiling !== undefined || (isPercentLike(m) && ys.some((y) => y > 30)) ? null : exponentialFit(xs, ys);
  const candidates = [lin, exp, logi].filter((f): f is Fit => !!f);
  const fit: Fit = candidates.reduce((best, f) => (f.r2 > best.r2 + 0.01 ? f : best), lin);
  const alt: Fit | null = candidates.filter((f) => f !== fit).sort((a, b) => b.r2 - a.r2)[0] ?? null;
  const capped = (v: number) => (ceiling !== undefined ? Math.min(ceiling, v) : v);
  const nonNeg = ys.every((y) => y >= 0);

  const future: Point[] = [];
  for (let x = last.x + step; x <= targetX + 1e-6; x = Math.round((x + step) * 10000) / 10000) {
    future.push({ x, label: ds.grain === "month" ? monthLabel(x) : String(Math.round(x)), value: capped(fit.predict(x)) });
  }
  const n = pts.length;
  const bandAt = (x: number) => {
    const h = (x - last.x) / step;
    const scale = fit.model === "exponential" ? fit.predict(x) / fit.predict(last.x) : 1;
    return 1.645 * fit.residualSd * Math.sqrt(1 + h / n) * scale;
  };
  const end = future[future.length - 1] ?? last;
  const endBand = bandAt(end.x);
  const low = Math.max(nonNeg ? 0 : -Infinity, end.value - endBand);
  const high = capped(end.value + endBand);
  const chg = changeOf(m, last.value, end.value);
  const implied = !isPercentLike(m) ? cagr(last.value, end.value, end.x - last.x) : NaN;

  const data: ChartDatum[] = [
    ...pts.map((p) => ({ label: p.label, actual: p.value, forecast: p.label === last.label ? p.value : null, low: null, range: null })),
    ...future.map((p) => {
      const b = bandAt(p.x);
      const lo = Math.max(nonNeg ? 0 : -Infinity, p.value - b);
      return { label: p.label, actual: null, forecast: round(p.value, 3), low: round(lo, 3), range: round(capped(p.value + b) - lo, 3) };
    }),
  ];
  const subject = subjectFor(entity, m);
  const subjectCap = cap(subject);

  const charts: ChartSpec[] = [
    {
      id: "forecast",
      type: "composed",
      title: `${subjectCap}: actuals and ${fit.model} projection to ${target}`,
      subtitle: "Shaded band = 90% prediction interval",
      data,
      xKey: "label",
      series: [
        { key: "actual", label: "Actual", kind: "area", color: PALETTE[0], format: m.format },
        { key: "forecast", label: "Forecast", kind: "line", color: PALETTE[3], dashed: true, format: m.format },
      ],
      band: { lowKey: "low", highKey: "range" },
      format: m.format,
      referenceX: [{ value: last.label, label: "Today" }],
      span: "full",
    },
    {
      id: "scenarios",
      type: "bar",
      title: `${target} scenarios`,
      subtitle: "Low / base / high (90% interval)",
      data: [
        { label: `Latest (${last.label})`, value: last.value, __color: MUTED },
        { label: "Low", value: round(low, 3), __color: NEG },
        { label: "Base", value: round(end.value, 3), __color: PALETTE[3] },
        { label: "High", value: round(high, 3), __color: POS },
      ],
      xKey: "label",
      series: [{ key: "value", label: m.label, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    },
    {
      id: "models",
      type: "bar",
      title: "Model comparison",
      subtitle: "Projected value and in-sample fit (R²)",
      data: candidates
        .map((f) => ({ label: `${cap(f.model)} (R² ${f.r2.toFixed(2)})`, value: round(capped(f.predict(end.x)), 3), __color: f === fit ? PALETTE[3] : MUTED })),
      xKey: "label",
      series: [{ key: "value", label: `${target} projection`, format: m.format }],
      format: m.format,
      colorByKey: "__color",
      span: "half",
    },
  ];

  const insights: Insight[] = [
    {
      kind: "forecast",
      title: `Base case: ${fmt(end.value, m.format)} by ${end.label}`,
      text: `Extrapolating the ${spanText(pts)} ${fit.model} trend, ${subject} reaches ${fmt(end.value, m.format)} (${chg.text} vs ${last.label})${Number.isFinite(implied) ? `, an implied ${pct(implied)} a year` : ""}.`,
      tone: toneFor(m, chg.value),
    },
    {
      kind: "trend",
      title: `90% range: ${fmt(low, m.format)} – ${fmt(high, m.format)}`,
      text: `The interval widens with the forecast horizon and reflects how noisy the history has been (residual σ = ${fmt(fit.residualSd, { ...m.format, prefix: m.format.prefix === "+" ? "" : m.format.prefix })}).`,
      tone: "neutral",
    },
  ];
  if (alt) {
    insights.push({
      kind: "comparison",
      title: `Model choice: ${fit.model} (R² ${fit.r2.toFixed(2)})`,
      text: `${alt.model === "exponential" ? "An" : "A"} ${alt.model} model fits ${alt.r2 < fit.r2 ? "worse" : "about as well"} (R² ${alt.r2.toFixed(2)}) and would project ${fmt(capped(alt.predict(end.x)), m.format)} — ${Math.abs(pctChange(end.value, capped(alt.predict(end.x)))).toFixed(0)}% ${capped(alt.predict(end.x)) > end.value ? "higher" : "lower"}.`,
      tone: "neutral",
    });
  }
  insights.push({
    kind: "caveat",
    title: "Statistical extrapolation, not a prediction",
    text: `This projects the historical pattern forward; it does not model policy changes, ${ds.id.startsWith("hk") ? "earnings, flows " : ""}or shocks.${fit.model === "logistic" ? ` The S-curve assumes saturation at ${fmt(ceiling, m.format)}.` : fit.model === "exponential" ? " Exponential trends rarely persist indefinitely." : ""}`,
    tone: "warning",
  });

  return {
    title: `${subjectCap} forecast to ${target}`,
    headline: `On its current ${fit.model} trend, ${subject} would reach about ${fmt(end.value, m.format)} by ${end.label} (90% range ${fmt(low, m.format)}–${fmt(high, m.format)}), versus ${fmt(last.value, m.format)} in ${last.label}.`,
    kpis: [
      { label: `Projected ${end.label}`, value: fmt(end.value, m.format), delta: `${chg.text} vs latest`, direction: direction(chg.value), good: goodness(m, chg.value) },
      { label: `Latest (${last.label})`, value: fmt(last.value, m.format), spark: sampleSpark(ys) },
      Number.isFinite(implied) ? { label: "Implied annual growth", value: pct(implied), direction: direction(implied) } : { label: "Change", value: chg.text, direction: direction(chg.value) },
      { label: "Model fit", value: `R² ${fit.r2.toFixed(2)}`, hint: `${fit.model} on ${n} points` },
    ],
    charts,
    insights,
    table: {
      columns: [
        { key: "label", label: "Period" },
        { key: "actual", label: "Actual", format: m.format, align: "right" },
        { key: "forecast", label: "Forecast", format: m.format, align: "right" },
        { key: "lowV", label: "Low (5%)", format: m.format, align: "right" },
        { key: "highV", label: "High (95%)", format: m.format, align: "right" },
      ],
      rows: data
        .filter((d) => d.actual === null || d.actual === undefined || pts.indexOf(pts.find((p) => p.label === d.label)!) >= pts.length - 6)
        .map((d) => ({
          label: d.label,
          actual: d.actual ?? null,
          forecast: d.actual === null ? d.forecast : null,
          lowV: d.low ?? null,
          highV: typeof d.low === "number" && typeof d.range === "number" ? round(d.low + d.range, 3) : null,
        })),
    },
    sql: `-- ${fit.model} regression on ${n} points\nSELECT REGR_SLOPE(${fit.model === "exponential" ? `LN(${m.key})` : m.key}, year) AS slope,\n       REGR_INTERCEPT(${fit.model === "exponential" ? `LN(${m.key})` : m.key}, year) AS intercept\nFROM ${tableName(ds)}${entity ? `\nWHERE ${(ds.entityLabel ?? "entity").toLowerCase()} = '${entity}'` : ""};`,
    followUps: [`${subjectCap} trend`, `Detect anomalies in ${subject}`, ds.kind === "panel" ? `Rank by ${lc(m.label)}` : `${m.label} since ${Math.floor(pts[0].x) + Math.floor(spanYears(pts) / 2)}`],
  };
}

function monthLabel(x: number): string {
  const y = Math.floor(x + 1e-6);
  const m = Math.round((x - y) * 12);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${String(y).slice(2)}`;
}

function anomaly(ds: Dataset, it: Interpretation): Draft {
  const g = grainWord(ds);
  const m = metric(ds, it.metrics[0]);
  const entity = ds.kind === "panel" ? it.entities[0] ?? defaultEntity(ds, m.key) : undefined;
  const pts = series(ds, m.key, it, entity);
  if (pts.length < 5) return empty(ds, "Need at least five data points to detect anomalies.");
  const usePoints = isPercentLike(m);
  const changes = pts.slice(1).map((p, i) => ({ ...p, change: usePoints ? p.value - pts[i].value : pctChange(pts[i].value, p.value) }));
  const zs = zScores(changes.map((c) => c.change));
  const scored = changes.map((c, i) => ({ ...c, z: zs[i] }));
  const threshold = 1.8;
  let flagged = scored.filter((s) => Math.abs(s.z) >= threshold);
  const strict = flagged.length > 0;
  if (!flagged.length) flagged = [...scored].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
  flagged.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const flaggedSet = new Set(flagged.map((f) => f.label));
  const changeFormat: NumberFormat = usePoints ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 };
  const vol = stdev(changes.map((c) => c.change));
  const subject = subjectFor(entity, m);
  const subjectCap = cap(subject);

  const charts: ChartSpec[] = [
    {
      id: "level",
      type: "composed",
      title: `${subjectCap} with flagged ${g.units}`,
      subtitle: `${strict ? `|z| ≥ ${threshold}` : "Largest moves"} on ${g.change} changes`,
      data: pts.map((p) => ({ label: p.label, value: p.value, flag: flaggedSet.has(p.label) ? p.value : null })),
      xKey: "label",
      series: [
        { key: "value", label: m.label, kind: "area", color: PALETTE[0], format: m.format },
        { key: "flag", label: "Anomaly", kind: "scatter", color: PALETTE[5], format: m.format },
      ],
      format: m.format,
      span: "full",
    },
    {
      id: "z",
      type: "bar",
      title: `${g.change} change z-scores`,
      subtitle: `Standard deviations from the average ${g.unit}ly move`,
      data: scored.map((s) => ({ label: s.label, z: round(s.z, 2), __color: Math.abs(s.z) >= threshold ? PALETTE[5] : MUTED })),
      xKey: "label",
      series: [{ key: "z", label: "z-score", format: { prefix: "+", decimals: 2 } }],
      format: { prefix: "+", decimals: 1 },
      colorByKey: "__color",
      referenceY: [
        { value: threshold, label: `+${threshold}σ` },
        { value: -threshold, label: `−${threshold}σ` },
      ],
      span: "half",
    },
    {
      id: "moves",
      type: "hbar",
      title: "Largest moves",
      subtitle: `${g.change} change`,
      data: [...scored]
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 8)
        .map((s) => ({ label: s.label, change: round(s.change, 2), __color: s.change >= 0 ? POS : NEG })),
      xKey: "label",
      series: [{ key: "change", label: "Change", format: changeFormat }],
      format: changeFormat,
      colorByKey: "__color",
      span: "half",
    },
  ];

  const insights: Insight[] = flagged.slice(0, 4).map((f) => {
    const ev = eventFor(f.x);
    return {
      kind: "anomaly",
      title: `${f.label}: ${f.change >= 0 ? "spike" : "drop"} of ${fmt(f.change, changeFormat)}`,
      text: `${subjectCap} moved to ${fmt(f.value, m.format)} — ${Math.abs(f.z).toFixed(1)}σ from a typical ${g.unit}.${ev ? ` This coincides with ${ev}.` : ""}`,
      tone: toneFor(m, f.change) === "positive" ? "positive" : "negative",
    };
  });
  insights.push({
    kind: "caveat",
    title: "Method",
    text: `Z-scores of ${g.unit}-over-${g.unit} ${usePoints ? "point" : "percent"} changes across ${changes.length} ${g.units}. Typical move: ±${fmt(vol, { ...changeFormat, prefix: "" })}.${strict ? "" : ` No move crossed ${threshold}σ, so the three largest are shown.`}`,
    tone: "neutral",
  });

  const top = flagged[0];
  return {
    title: `Anomalies in ${subject}`,
    headline: `${strict ? `${flagged.length} anomalous ${flagged.length === 1 ? g.unit : g.units} detected` : "No extreme anomalies"} in ${subject}; the largest was ${top.label} (${fmt(top.change, changeFormat)}, ${Math.abs(top.z).toFixed(1)}σ)${eventFor(top.x) ? `, during ${eventFor(top.x)}` : ""}.`,
    kpis: [
      { label: "Anomalies flagged", value: String(strict ? flagged.length : 0), hint: `of ${changes.length} ${g.units}` },
      { label: `Largest move (${top.label})`, value: fmt(top.change, changeFormat), direction: direction(top.change), good: goodness(m, top.change) },
      { label: `Typical ${g.change} move`, value: `±${fmt(vol, { ...changeFormat, prefix: "" })}`, hint: "1 standard deviation" },
      { label: `Latest z-score (${scored[scored.length - 1].label})`, value: scored[scored.length - 1].z.toFixed(2), hint: Math.abs(scored[scored.length - 1].z) >= threshold ? "Anomalous" : "Within normal range" },
    ],
    charts,
    insights,
    table: {
      columns: [
        { key: "label", label: "Period" },
        { key: "value", label: m.label, format: m.format, align: "right" },
        { key: "change", label: g.change, format: changeFormat, align: "right" },
        { key: "z", label: "z-score", format: { prefix: "+", decimals: 2 }, align: "right" },
      ],
      rows: [...scored].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).map((s) => ({ label: s.label, value: s.value, change: cell(s.change), z: cell(s.z) })),
    },
    sql: `WITH changes AS (\n  SELECT period, ${m.key},\n         ${m.key} - LAG(${m.key}) OVER (ORDER BY period) AS delta\n  FROM ${tableName(ds)}${entity ? ` WHERE ${(ds.entityLabel ?? "entity").toLowerCase()} = '${entity}'` : ""}\n)\nSELECT period, delta,\n       (delta - AVG(delta) OVER ()) / STDDEV(delta) OVER () AS z\nFROM changes\nWHERE ABS(z) >= ${threshold};`,
    followUps: [`${subjectCap} trend`, `Forecast ${subject} to ${Math.floor(pts[pts.length - 1].x) + (ds.grain === "month" ? 1 : 3)}`, ds.kind === "panel" ? `Compare ${(ds.entities ?? []).slice(0, 2).map((e) => e.name).join(" and ")}` : `${m.label} vs ${ds.metrics.find((x) => x.key !== m.key)?.label.toLowerCase() ?? lc(m.label)}`],
  };
}

function growth(ds: Dataset, it: Interpretation): Draft {
  const m = metric(ds, it.metrics[0]);
  const ents = (ds.entities ?? []).map((e) => e.name);
  const rows = ents
    .map((e) => {
      const pts = series(ds, m.key, { ...it, year: undefined }, e);
      if (pts.length < 2) return null;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const yrs = last.x - first.x;
      const c = !isPercentLike(m) && first.value > 0 && last.value > 0 ? cagr(first.value, last.value, yrs) : NaN;
      const ch = changeOf(m, first.value, last.value);
      return { e, first, last, cagr: c, change: ch, pts, valid: isPercentLike(m) || first.value > 0 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.filter((r) => !r.valid);
  if (!valid.length) return empty(ds, "No entities with a positive starting value to compute growth.");
  const useCagr = !isPercentLike(m) && ds.grain !== "month";
  const metricOf = (r: (typeof rows)[number]) => (useCagr ? r.cagr : r.change.value);
  valid.sort((a, b) => metricOf(b) - metricOf(a));
  const fmtG: NumberFormat = isPercentLike(m) ? { prefix: "+", suffix: pointSuffix(m), decimals: 1 } : { prefix: "+", suffix: "%", decimals: 1 };
  const label = (ds.entityLabel ?? "entity").toLowerCase();
  const span = `${valid[0].first.label}–${valid[0].last.label}`;
  const best = valid[0];
  const worst = valid[valid.length - 1];

  const charts: ChartSpec[] = [
    {
      id: "growth",
      type: "hbar",
      title: `${useCagr ? "Compound annual growth" : "Total change"} in ${lc(m.label)}`,
      subtitle: span,
      data: valid.map((r) => ({ label: r.e, g: round(metricOf(r), 2), __color: metricOf(r) >= 0 ? POS : NEG })),
      xKey: "label",
      series: [{ key: "g", label: useCagr ? "CAGR" : "Change", format: fmtG }],
      format: fmtG,
      colorByKey: "__color",
      span: "full",
    },
    { ...multiLine(ds, m, valid.slice(0, 5).map((r) => r.e), it, `Fastest growers — rebased to 100`, true), span: "half" },
    {
      id: "start-end",
      type: "bar",
      title: `${m.label}: start vs latest`,
      subtitle: `Top ${Math.min(8, valid.length)} by growth`,
      data: valid.slice(0, 8).map((r) => ({ label: r.e, start: r.first.value, latest: r.last.value })),
      xKey: "label",
      series: [
        { key: "start", label: valid[0].first.label, color: MUTED, format: m.format },
        { key: "latest", label: valid[0].last.label, color: PALETTE[0], format: m.format },
      ],
      format: m.format,
      span: "half",
    },
  ];
  const grew = valid.filter((r) => metricOf(r) > 0).length;
  const insights: Insight[] = [
    {
      kind: "trend",
      title: `${best.e} grew fastest`,
      text: `${best.e} went from ${fmt(best.first.value, m.format)} to ${fmt(best.last.value, m.format)} (${best.change.text}${useCagr ? `, ${pct(best.cagr)} a year` : ""}).`,
      tone: "positive",
    },
    {
      kind: "low",
      title: `${worst.e} ${metricOf(worst) >= 0 ? "grew slowest" : "shrank the most"}`,
      text: `${worst.e}: ${fmt(worst.first.value, m.format)} → ${fmt(worst.last.value, m.format)} (${worst.change.text}).`,
      tone: metricOf(worst) >= 0 ? "neutral" : "negative",
    },
    {
      kind: "momentum",
      title: `${grew} of ${valid.length} ${plural(label)} grew`,
      text: `Median ${useCagr ? "CAGR" : "change"}: ${fmt(median(valid.map(metricOf)), fmtG)}. ${valid.length >= 3 ? `The top three were ${listJoin(valid.slice(0, 3).map((r) => r.e))}.` : ""}`,
      tone: grew >= valid.length / 2 ? "positive" : "negative",
    },
  ];
  if (invalid.length) {
    insights.push({
      kind: "caveat",
      title: "Not meaningful for some",
      text: `${listJoin(invalid.map((r) => r.e))} started from a zero or negative value, so growth rates are not meaningful and they are excluded.`,
      tone: "warning",
    });
  }

  return {
    title: `Who grew ${lc(m.label)} fastest?`,
    headline: `${best.e} grew ${lc(m.label)} fastest over ${span} (${useCagr ? `${pct(best.cagr)} CAGR` : best.change.text}), while ${worst.e} ${metricOf(worst) >= 0 ? "grew slowest" : "declined most"} (${useCagr && Number.isFinite(worst.cagr) ? pct(worst.cagr) : worst.change.text}).`,
    kpis: [
      { label: "Fastest grower", value: best.e, delta: useCagr ? `${pct(best.cagr)} CAGR` : best.change.text, direction: "up", good: true },
      { label: metricOf(worst) >= 0 ? "Slowest grower" : "Biggest decline", value: worst.e, delta: useCagr && Number.isFinite(worst.cagr) ? `${pct(worst.cagr)} CAGR` : worst.change.text, direction: direction(metricOf(worst)), good: metricOf(worst) >= 0 },
      { label: `Median ${useCagr ? "CAGR" : "change"}`, value: fmt(median(valid.map(metricOf)), fmtG) },
      { label: "Grew / shrank", value: `${grew} / ${valid.length - grew}`, hint: span },
    ],
    charts,
    insights,
    table: {
      columns: [
        { key: "entity", label: ds.entityLabel ?? "Entity" },
        { key: "first", label: valid[0].first.label, format: m.format, align: "right" },
        { key: "last", label: valid[0].last.label, format: m.format, align: "right" },
        { key: "change", label: "Change", format: fmtG, align: "right" },
        ...(useCagr ? [{ key: "cagr", label: "CAGR", format: { prefix: "+", suffix: "%", decimals: 1 }, align: "right" as const }] : []),
      ],
      rows: [...valid, ...invalid].map((r) => ({ entity: r.e, first: r.first.value, last: r.last.value, change: r.valid ? cell(r.change.value) : null, cagr: cell(r.cagr) })),
    },
    sql: `SELECT ${label},\n       POWER(MAX_BY(${m.key}, year) / MIN_BY(${m.key}, year), 1.0 / (MAX(year) - MIN(year))) - 1 AS cagr\nFROM ${tableName(ds)}\nGROUP BY ${label}\nORDER BY cagr DESC;`,
    followUps: [`${best.e} ${lc(m.label)} trend`, `Compare ${best.e} and ${worst.e}`, `Forecast ${best.e} ${lc(m.label)}`],
  };
}

function snapshot(ds: Dataset, it: Interpretation): Draft {
  const e = it.entities[0];
  const row = ds.rows.find((r) => r.entity === e);
  if (!row) return empty(ds, `No data for ${e}.`);
  const metrics = ds.metrics.filter((m) => num(row, m.key) !== undefined);
  const rankInfo = metrics.map((m) => {
    const vals = ds.rows.filter((r) => num(r, m.key) !== undefined).map((r) => ({ e: r.entity as string, v: num(r, m.key) as number }));
    vals.sort((a, b) => b.v - a.v);
    const pos = vals.findIndex((v) => v.e === e) + 1;
    const pctile = vals.length > 1 ? (1 - (pos - 1) / (vals.length - 1)) * 100 : 100;
    return { m, v: num(row, m.key) as number, pos, of: vals.length, pctile, median: median(vals.map((x) => x.v)) };
  });
  const group = ds.groupAttrs?.[0];
  const groupVal = group ? String(row[group.key]) : undefined;
  const peers = group ? ds.rows.filter((r) => r[group.key] === groupVal && r.entity !== e).map((r) => r.entity as string) : [];

  const charts: ChartSpec[] = [];
  if (metrics.length >= 3) {
    charts.push({
      id: "radar",
      type: "radar",
      title: `${e} vs median`,
      subtitle: "Percentile rank within the dataset (100 = highest)",
      data: rankInfo.map((r) => ({ label: r.m.short ?? r.m.label, [e]: round(r.pctile, 0), Median: 50 })),
      xKey: "label",
      series: [
        { key: e, label: e, color: PALETTE[3], format: { decimals: 0 } },
        { key: "Median", label: "Median", color: MUTED, format: { decimals: 0 } },
      ],
      format: { decimals: 0 },
      span: "half",
    });
  }
  const m0 = rankInfo[0];
  charts.push({
    id: "position",
    type: "hbar",
    title: `${m0.m.label}: where ${e} sits`,
    subtitle: ds.name,
    data: ds.rows
      .filter((r) => num(r, m0.m.key) !== undefined)
      .sort((a, b) => (num(b, m0.m.key) as number) - (num(a, m0.m.key) as number))
      .slice(0, 15)
      .map((r) => ({ label: r.entity as string, value: num(r, m0.m.key) as number, __color: r.entity === e ? PALETTE[3] : peers.includes(r.entity as string) ? PALETTE[4] : PALETTE[0] })),
    xKey: "label",
    series: [{ key: "value", label: m0.m.label, format: m0.m.format }],
    format: m0.m.format,
    colorByKey: "__color",
    span: metrics.length >= 3 ? "half" : "full",
  });
  for (const other of DATASETS) {
    if (other.kind !== "panel" || other.id === ds.id || !other.rows.some((r) => r.entity === e)) continue;
    if (!other.id.startsWith(ds.id.split("-")[0])) continue;
    const om = metric(other, other.defaultMetric);
    const pts = series(other, om.key, { ...it, yearFrom: undefined, yearTo: undefined, year: undefined }, e);
    if (pts.length < 2) continue;
    charts.push({
      id: `related-${other.id}`,
      type: other.grain === "month" ? "area" : "bar",
      title: `${e}: ${lc(om.label)}`,
      subtitle: `${other.name} · ${spanText(pts)}`,
      data: pts.map((p) => ({ label: p.label, value: p.value })),
      xKey: "label",
      series: [{ key: "value", label: om.label, color: PALETTE[3], format: om.format }],
      format: om.format,
      span: "half",
    });
  }

  const strengths = rankInfo.filter((r) => r.pctile >= 75);
  const weak = rankInfo.filter((r) => r.pctile <= 25);
  const insights: Insight[] = rankInfo.slice(0, 4).map((r) => ({
    kind: "comparison",
    title: `${r.m.label}: #${r.pos} of ${r.of}`,
    text: `${fmt(r.v, r.m.format)} versus a median of ${fmt(r.median, r.m.format)} (${r.v >= r.median ? "above" : "below"} median${r.m.higherIsBetter === false ? "; lower is better" : ""}).`,
    tone: r.m.higherIsBetter === undefined ? "neutral" : (r.v >= r.median) === r.m.higherIsBetter ? "positive" : "negative",
  }));
  if (peers.length && group) {
    insights.push({ kind: "share", title: `${groupVal} peers`, text: `Other ${groupVal?.toLowerCase()} names in the dataset: ${listJoin(peers)}.`, tone: "neutral" });
  }

  return {
    title: `${e} at a glance`,
    headline: `${e} ranks #${m0.pos} of ${m0.of} on ${lc(m0.m.label)} (${fmt(m0.v, m0.m.format)})${strengths.length ? `, with top-quartile ${listJoin(strengths.map((s) => lc(s.m.label)))}` : ""}${weak.length ? ` and bottom-quartile ${listJoin(weak.map((s) => lc(s.m.label)))}` : ""}.`,
    kpis: rankInfo.slice(0, 4).map((r) => ({ label: r.m.label, value: fmt(r.v, r.m.format), hint: `#${r.pos} of ${r.of}` })),
    charts,
    insights,
    table: {
      columns: [
        { key: "metric", label: "Metric" },
        { key: "value", label: e, align: "right" },
        { key: "median", label: "Median", align: "right" },
        { key: "rank", label: "Rank", align: "right" },
      ],
      rows: rankInfo.map((r) => ({ metric: r.m.label, value: fmt(r.v, r.m.format), median: fmt(r.median, r.m.format), rank: `#${r.pos} / ${r.of}` })),
    },
    sql: `SELECT *,\n       ${metrics.map((m) => `RANK() OVER (ORDER BY ${m.key} DESC) AS ${m.key}_rank`).join(",\n       ")}\nFROM ${tableName(ds)}\nQUALIFY ${(ds.entityLabel ?? "entity").toLowerCase()} = '${e}';`,
    followUps: [peers[0] ? `Compare ${e} and ${peers[0]}` : `Top 10 by ${lc(m0.m.label)}`, ...(ds.id.startsWith("hk") ? [`${e} revenue and profit trend`, `${e} share price`] : [`Top 10 by ${lc(m0.m.label)}`])],
  };
}

function empty(ds: Dataset, reason: string): Draft {
  return {
    title: "Not enough data",
    headline: reason,
    kpis: [],
    charts: [],
    insights: [{ kind: "caveat", title: "Try rephrasing", text: `${reason} Try widening the time range or naming a different metric from ${ds.name}.`, tone: "warning" }],
    table: { columns: [], rows: [] },
    sql: `-- ${reason}`,
    followUps: [`${metric(ds, ds.defaultMetric).label} trend`, `Top 10 by ${lc(metric(ds, ds.defaultMetric).label)}`],
  };
}

// ---------- entry ----------

const INTENT_LABEL: Record<Interpretation["intent"], string> = {
  trend: "trend analysis",
  rank: "ranking",
  share: "composition breakdown",
  compare: "comparison",
  correlation: "correlation analysis",
  forecast: "forecast",
  anomaly: "anomaly detection",
  growth: "growth ranking",
  snapshot: "entity profile",
};

export function analyze(it: Interpretation, useCaseId: string): InsightReport {
  const ds = DATASET_BY_ID[it.datasetId];
  eventScope = { grain: ds.grain, enabled: EVENT_DATASETS.test(ds.id) };
  const draft =
    it.intent === "trend"
      ? trend(ds, it)
      : it.intent === "rank"
        ? rank(ds, it)
        : it.intent === "share"
          ? share(ds, it)
          : it.intent === "compare"
            ? compare(ds, it)
            : it.intent === "correlation"
              ? correlation(ds, it)
              : it.intent === "forecast"
                ? forecast(ds, it)
                : it.intent === "anomaly"
                  ? anomaly(ds, it)
                  : it.intent === "growth"
                    ? growth(ds, it)
                    : snapshot(ds, it);

  const metricsText = it.metrics.map((k) => metric(ds, k).label).join(", ");
  const steps = [
    `Classified intent as ${INTENT_LABEL[it.intent]} (${Math.round(it.confidence * 100)}% confidence)`,
    `Routed to “${ds.name}” · ${ds.rows.length.toLocaleString()} rows`,
    `Resolved metric${it.metrics.length > 1 ? "s" : ""}: ${metricsText}${it.entities.length ? ` · ${ds.entityLabel ?? "entities"}: ${it.entities.join(", ")}` : ""}`,
    it.yearFrom !== undefined || it.yearTo !== undefined || it.year !== undefined || it.targetYear !== undefined
      ? `Applied time scope: ${[it.yearFrom !== undefined ? `from ${Math.floor(it.yearFrom)}` : "", it.yearTo !== undefined ? `to ${it.yearTo}` : "", it.year !== undefined ? `year ${it.year}` : "", it.targetYear !== undefined ? `forecast to ${it.targetYear}` : ""].filter(Boolean).join(" ")}`
      : "Using full available history",
    `Computed ${draft.kpis.length} KPIs and ${draft.insights.length} findings`,
    `Rendered ${draft.charts.length} visualization${draft.charts.length === 1 ? "" : "s"}: ${[...new Set(draft.charts.map((c) => c.type))].join(", ")}`,
  ];

  return {
    ...draft,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    question: it.question,
    useCaseId,
    interpretation: it,
    steps,
    source: ds.source,
    asOf: ds.asOf,
  };
}
