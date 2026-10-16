"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/engine/format";
import type { Insight, InsightReport, Kpi } from "@/lib/types";
import { ChartView } from "./chart-view";
import type { Entry } from "./insight-store";

const INTENT_LABEL: Record<string, string> = {
  trend: "Trend",
  rank: "Ranking",
  share: "Breakdown",
  compare: "Comparison",
  correlation: "Correlation",
  forecast: "Forecast",
  anomaly: "Anomaly detection",
  growth: "Growth",
  snapshot: "Profile",
};

const TONE: Record<NonNullable<Insight["tone"]>, string> = {
  positive: "border-emerald-600",
  negative: "border-rose-600",
  warning: "border-amber-500",
  neutral: "border-slate-300",
};

const THINKING: [string, string, string][] = [
  ["parse_question", "Reading the question", "Tokenised query, detected intent"],
  ["extract_entities", "Matching metrics, entities and time range", "Resolved metrics and entities"],
  ["select_dataset", "Scoring datasets in the catalog", "Picked the best-matching dataset"],
  ["run_query", "Querying rows and running statistics", "Aggregated rows, computed statistics"],
  ["plan_visuals", "Choosing visualizations", "Selected chart types"],
  ["write_answer", "Drafting the answer", "Answer ready"],
];
const DEFAULT_PLAN = [450, 650, 850, 1300, 650, 900];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Thinking({ startedAt, plan = DEFAULT_PLAN }: { startedAt: number; plan?: number[] }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const ends = plan.reduce<number[]>((acc, ms) => [...acc, (acc.at(-1) ?? 0) + ms], []);
  const found = ends.findIndex((end) => elapsed < end);
  const step = found === -1 ? THINKING.length - 1 : found;
  return (
    <div className="space-y-2 py-1" aria-live="polite">
      <div className="meta flex items-center gap-3 text-slate-500">
        <span className="animate-pulse text-sky-400">Working</span>
        <span className="tabular-nums">{secs(elapsed)}</span>
        <span>
          Step {step + 1}/{THINKING.length}
        </span>
      </div>
      <ol className="meta space-y-1.5">
        {THINKING.slice(0, step + 1).map(([tool, running, done], i) => {
          const isDone = i < step;
          const start = i === 0 ? 0 : ends[i - 1];
          return (
            <li key={tool} className="reveal grid grid-cols-[2.5rem_9rem_1fr_3rem] items-center gap-2">
              {isDone ? <span className="text-slate-500">ok</span> : <span className="animate-pulse text-sky-400">run</span>}
              <span className="text-slate-200">{tool}</span>
              <span className={clsx("truncate normal-case tracking-normal", isDone ? "text-slate-500" : "text-slate-200")}>
                {isDone ? done : `${running}…`}
              </span>
              <span className="text-right tabular-nums text-slate-500">{secs(isDone ? plan[i] : elapsed - start)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AgentTrace({ report }: { report: InsightReport }) {
  const it = report.interpretation;
  const calls: [string, string][] = [
    ["parse_question", `${INTENT_LABEL[it.intent] ?? it.intent}${it.entities.length ? ` · ${it.entities.slice(0, 3).join(", ")}` : ""}`],
    ["select_dataset", `${it.datasetName} (${Math.round(it.confidence * 100)}% match)`],
    ["run_query", `${report.table.rows.length} rows returned`],
    ["compute_stats", `${report.insights.length} findings, ${report.kpis.length} KPIs`],
    ["render_charts", `${report.charts.length} chart${report.charts.length === 1 ? "" : "s"}`],
  ];
  return (
    <details className="group">
      <summary className="meta flex w-fit cursor-pointer list-none items-center gap-2 py-1 text-slate-500 transition hover:text-slate-200">
        <span className="inline-block transition group-open:rotate-90">›</span>
        Trace · {calls.length} tool calls
      </summary>
      <ol className="meta mt-2 space-y-1.5">
        {calls.map(([tool, result]) => (
          <li key={tool} className="grid grid-cols-[2.5rem_9rem_1fr] items-center gap-2 text-slate-500">
            <span>ok</span>
            <span className="text-slate-200">{tool}</span>
            <span className="normal-case tracking-normal">{result}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Sparkline({ values, up }: { values: number[]; up?: boolean }) {
  if (values.length < 2) return null;
  const w = 88;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`);
  const color = up === undefined ? "text-slate-400" : up ? "text-emerald-600" : "text-rose-600";
  return (
    <svg width={w} height={h} className={clsx("overflow-visible", color)}>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <rect x={w - 2} y={Number(pts[pts.length - 1].split(",")[1]) - 2} width={4} height={4} fill="currentColor" />
    </svg>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const deltaColor = kpi.good === undefined ? "text-slate-400" : kpi.good ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="min-w-0 bg-slate-950 px-4 py-3.5">
      <div className="meta truncate text-slate-500">{kpi.label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums text-white">{kpi.value}</div>
        {kpi.spark && <Sparkline values={kpi.spark} up={kpi.good} />}
      </div>
      {kpi.delta && (
        <div className={clsx("mt-2 truncate font-mono text-[11px] tabular-nums", deltaColor)}>{kpi.delta}</div>
      )}
      {kpi.hint && <div className="mt-1 truncate text-[11px] text-slate-500">{kpi.hint}</div>}
    </div>
  );
}

function toCsv(report: InsightReport): string {
  const cols = report.table.columns;
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => esc(c.label)).join(","), ...report.table.rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Tab = "data" | "sql" | "method";

export function ReportBody({
  report,
  compact,
  onAsk,
  headlineWords,
  stage = Infinity,
}: {
  report: InsightReport;
  compact?: boolean;
  onAsk?: (q: string) => void;
  headlineWords?: number;
  stage?: number;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const charts = compact ? report.charts.slice(0, 1) : report.charts;
  const words = report.headline.split(" ");
  const typing = headlineWords !== undefined && headlineWords < words.length;
  return (
    <div className="space-y-6">
      <p className={clsx("max-w-3xl font-semibold leading-snug tracking-tight text-white", compact ? "text-base" : "text-xl md:text-[22px]", typing && "caret")}>
        {headlineWords === undefined ? report.headline : words.slice(0, headlineWords).join(" ")}
      </p>

      {stage >= 1 && report.kpis.length > 0 && (
        <div className={clsx("reveal grid gap-px border border-slate-700 bg-slate-700", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
          {(compact ? report.kpis.slice(0, 2) : report.kpis).map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>
      )}

      {stage >= 2 && charts.length > 0 && (
        <div className="reveal grid gap-px border border-slate-700 bg-slate-700 lg:grid-cols-2">
          {charts.map((c, ci) => (
            <figure key={c.id} className={clsx("min-w-0 bg-slate-950 p-4", (c.span === "full" || compact || charts.length === 1) && "lg:col-span-2", charts.length % 2 === 1 && ci === charts.length - 1 && "lg:col-span-2")}>
              <figcaption className="mb-3 flex items-baseline gap-3">
                <span className="meta shrink-0 text-slate-500">Fig.{String(ci + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{c.title}</span>
                  {c.subtitle && <span className="block text-xs text-slate-500">{c.subtitle}</span>}
                </span>
              </figcaption>
              <ChartView spec={c} height={compact ? 220 : undefined} />
            </figure>
          ))}
        </div>
      )}

      {stage >= 3 && !compact && report.insights.length > 0 && (
        <section className="reveal">
          <h3 className="meta mb-2 text-slate-500">Findings</h3>
          <ol className="grid gap-x-8 border-t border-slate-700 md:grid-cols-2">
            {report.insights.map((i, idx) => (
              <li key={idx} className="grid grid-cols-[2rem_1fr] gap-2 border-b border-slate-700 py-3">
                <span className={clsx("meta border-l-2 pl-1.5 text-slate-500", TONE[i.tone ?? "neutral"])}>{String(idx + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{i.title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{i.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {stage >= 4 && !compact && (
        <>
          <div className="reveal flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-700">
            {(
              [
                ["data", `Data · ${report.table.rows.length}`],
                ["sql", "SQL"],
                ["method", "Method"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(tab === key ? null : key)}
                aria-pressed={tab === key}
                className={clsx(
                  "meta -mb-px border-b-2 py-2 transition",
                  tab === key ? "border-slate-100 text-white" : "border-transparent text-slate-500 hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
            <a href={report.source.url} target="_blank" rel="noreferrer" className="meta ml-auto flex items-center gap-1.5 py-2 text-slate-500 transition hover:text-slate-200">
              Src: {report.source.name} · {report.asOf} ↗
            </a>
          </div>

          {tab === "data" && report.table.columns.length > 0 && (
            <div className="max-h-80 overflow-auto border border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="meta sticky top-0 bg-slate-800 text-slate-400">
                  <tr>
                    {report.table.columns.map((c) => (
                      <th key={c.key} className={clsx("px-3 py-2 font-medium", c.align === "right" && "text-right")}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.table.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      {report.table.columns.map((c) => {
                        const v = r[c.key];
                        return (
                          <td key={c.key} className={clsx("px-3 py-1.5 text-slate-300", c.align === "right" && "text-right font-mono text-[13px]")}>
                            {typeof v === "number" && c.format ? fmt(v, c.format) : v === null || v === undefined ? "—" : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "sql" && (
            <pre className="overflow-x-auto border border-slate-700 bg-slate-950 p-4 font-mono text-[12.5px] leading-relaxed text-slate-200">{report.sql}</pre>
          )}
          {tab === "method" && (
            <div className="space-y-3 border border-slate-700 bg-slate-950 p-4">
              <ol className="space-y-2">
                {report.steps.map((s, i) => (
                  <li key={i} className="grid grid-cols-[2rem_1fr] gap-2 text-sm text-slate-300">
                    <span className="meta pt-0.5 text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                    {s}
                  </li>
                ))}
              </ol>
              {report.source.note && <p className="border-t border-slate-700 pt-3 text-xs text-slate-500">Source note: {report.source.note}</p>}
            </div>
          )}

          {report.followUps.length > 0 && onAsk && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="meta text-slate-500">Next →</span>
              {[...new Set(report.followUps)].map((f) => (
                <button
                  key={f}
                  onClick={() => onAsk(f)}
                  className="border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InterpretationChips({ report }: { report: InsightReport }) {
  const it = report.interpretation;
  const chips = [
    { label: INTENT_LABEL[it.intent] ?? it.intent, strong: true },
    { label: it.datasetName },
    ...(it.entities.length ? [{ label: it.entities.slice(0, 4).join(", ") + (it.entities.length > 4 ? ` +${it.entities.length - 4}` : "") }] : []),
    ...(it.yearFrom !== undefined || it.yearTo !== undefined ? [{ label: `${it.yearFrom !== undefined ? Math.floor(it.yearFrom) : "…"}–${it.yearTo ?? "now"}` }] : []),
    ...(it.targetYear ? [{ label: `→ ${it.targetYear}` }] : []),
  ];
  return (
    <div className="meta flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
      {chips.map((c, i) => (
        <span key={i} className={c.strong ? "text-slate-200" : undefined}>
          {c.label}
        </span>
      ))}
      <span className="tabular-nums">{Math.round(it.confidence * 100)}% match</span>
    </div>
  );
}

const WORD_MS = 45;
const STAGE_TICKS = 8;
const STAGES = 4;

function useStream(id: string, report: InsightReport | undefined, live: boolean | undefined, onSettled: (id: string) => void) {
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [tick, setTick] = useState(0);
  const total = report ? report.headline.split(" ").length : 0;
  const animate = !!report && !!live && !reduced;
  const done = !animate || tick >= total + STAGES * STAGE_TICKS;

  useEffect(() => {
    if (!report) return;
    if (done) {
      if (live) onSettled(id);
      return;
    }
    const t = setInterval(() => setTick((n) => n + 1), WORD_MS);
    return () => clearInterval(t);
  }, [id, report, done, live, onSettled]);

  if (done) return { words: undefined, stage: Infinity, done };
  return { words: Math.min(total, tick), stage: tick < total ? 0 : Math.floor((tick - total) / STAGE_TICKS) + 1, done };
}

export function ChatTurn({
  entry,
  index,
  onAsk,
  onRemove,
  onSettled,
  pinned,
  onTogglePin,
}: {
  entry: Entry;
  index: number;
  onAsk: (q: string) => void;
  onRemove: () => void;
  onSettled: (id: string) => void;
  pinned: boolean;
  onTogglePin: (r: InsightReport) => void;
}) {
  const [copied, setCopied] = useState(false);
  const report = entry.report;
  const stream = useStream(entry.id, report, entry.live, onSettled);
  const n = String(index).padStart(2, "0");

  const copyLink = async () => {
    const url = `${window.location.origin}/?uc=${entry.useCaseId}&q=${encodeURIComponent(entry.question)}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article id={entry.id} className="scroll-mt-24 border-t border-slate-600 pt-5" aria-busy={!stream.done || entry.status === "loading"}>
      <div className="grid grid-cols-[3rem_1fr] gap-x-3 md:grid-cols-[4rem_1fr]">
        <span className="meta pt-1.5 text-slate-500">Q.{n}</span>
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-white md:text-xl">{entry.question}</h2>
      </div>

      <div className="mt-5 grid grid-cols-[3rem_1fr] gap-x-3 md:grid-cols-[4rem_1fr]">
        <span className="meta pt-0.5 text-slate-400">A.{n}</span>
        <div className="min-w-0 space-y-4">
          {report && <InterpretationChips report={report} />}
          {entry.status === "loading" && <Thinking startedAt={entry.startedAt} plan={entry.plan} />}
          {entry.status === "error" && (
            <div className="flex items-center gap-3 border-l-2 border-rose-600 bg-white/[0.03] p-3 text-sm text-slate-200">
              <span className="meta text-rose-400">Err</span>
              {entry.error}
              <button onClick={onRemove} className="meta ml-auto underline">
                Dismiss
              </button>
            </div>
          )}
          {report && (
            <>
              <AgentTrace report={report} />
              <ReportBody report={report} onAsk={onAsk} headlineWords={stream.words} stage={stream.stage} />
              {stream.done && (
                <div className="reveal meta flex flex-wrap items-center gap-1 text-slate-400">
                  <ActionButton onClick={() => onTogglePin(report)} active={pinned}>
                    {pinned ? "Pinned" : "Pin to dashboard"}
                  </ActionButton>
                  <ActionButton onClick={() => download(`${report.title.replace(/[^\w]+/g, "-").toLowerCase()}.csv`, toCsv(report))}>Export CSV</ActionButton>
                  <ActionButton onClick={copyLink}>{copied ? "Copied" : "Copy link"}</ActionButton>
                  <ActionButton onClick={onRemove}>Remove</ActionButton>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ActionButton({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "flex min-h-8 items-center border px-2.5 transition",
        active ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-700 hover:border-slate-500 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
