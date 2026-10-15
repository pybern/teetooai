"use client";

import clsx from "clsx";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Crown,
  Database,
  Download,
  ExternalLink,
  GitCompareArrows,
  Layers,
  Lightbulb,
  Link as LinkIcon,
  LoaderCircle,
  Minus,
  Pin,
  PinOff,
  Sigma,
  Table2,
  Target,
  Telescope,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/engine/format";
import type { Insight, InsightKind, InsightReport, Kpi } from "@/lib/types";
import { USE_CASE_BY_ID } from "@/lib/usecases";
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

const KIND_ICON: Record<InsightKind, LucideIcon> = {
  trend: TrendingUp,
  peak: Crown,
  low: TrendingDown,
  comparison: GitCompareArrows,
  anomaly: Activity,
  share: Layers,
  forecast: Telescope,
  correlation: Sigma,
  concentration: Target,
  momentum: Workflow,
  caveat: TriangleAlert,
};

const TONE: Record<NonNullable<Insight["tone"]>, string> = {
  positive: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20",
  negative: "text-rose-300 bg-rose-400/10 ring-rose-400/20",
  warning: "text-amber-300 bg-amber-400/10 ring-amber-400/20",
  neutral: "text-sky-300 bg-sky-400/10 ring-sky-400/20",
};

const THINKING = [
  "Parsing the question",
  "Matching metrics, entities and time range",
  "Routing to the best dataset",
  "Running statistics",
  "Choosing visualizations",
  "Writing the narrative",
];

function Thinking({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, []);
  const step = Math.min(THINKING.length - 1, Math.floor((now - startedAt) / 230));
  return (
    <div className="space-y-2.5 py-2">
      {THINKING.map((s, i) => (
        <div key={s} className={clsx("flex items-center gap-3 text-sm transition-opacity", i > step ? "opacity-30" : "opacity-100")}>
          {i < step ? <Check className="h-4 w-4 text-emerald-400" /> : i === step ? <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" /> : <span className="h-4 w-4 rounded-full border border-white/15" />}
          <span className={i === step ? "text-slate-100" : "text-slate-400"}>{s}</span>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 pt-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
    </div>
  );
}

function Sparkline({ values, up }: { values: number[]; up?: boolean }) {
  if (values.length < 2) return null;
  const w = 88;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`);
  const color = up === undefined ? "#60a5fa" : up ? "#34d399" : "#f87171";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={pts[pts.length - 1].split(",")[1]} r={2.5} fill={color} />
    </svg>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const DeltaIcon = kpi.direction === "up" ? ArrowUpRight : kpi.direction === "down" ? ArrowDownRight : Minus;
  const deltaColor = kpi.good === undefined ? "text-slate-400" : kpi.good ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{kpi.label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="truncate text-2xl font-semibold tracking-tight text-white">{kpi.value}</div>
        {kpi.spark && <Sparkline values={kpi.spark} up={kpi.good} />}
      </div>
      {kpi.delta && (
        <div className={clsx("mt-1 flex items-center gap-1 text-xs", deltaColor)}>
          {kpi.direction && kpi.direction !== "flat" && <DeltaIcon className="h-3.5 w-3.5" />}
          <span className="truncate">{kpi.delta}</span>
        </div>
      )}
      {kpi.hint && <div className="mt-1 truncate text-xs text-slate-500">{kpi.hint}</div>}
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

export function ReportBody({ report, compact, onAsk }: { report: InsightReport; compact?: boolean; onAsk?: (q: string) => void }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const charts = compact ? report.charts.slice(0, 1) : report.charts;
  return (
    <div className="space-y-5">
      <p className={clsx("font-medium leading-snug text-slate-100", compact ? "text-base" : "text-lg md:text-xl")}>
        <Lightbulb className="mr-2 inline h-5 w-5 -translate-y-0.5 text-amber-300" />
        {report.headline}
      </p>

      {report.kpis.length > 0 && (
        <div className={clsx("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
          {(compact ? report.kpis.slice(0, 2) : report.kpis).map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>
      )}

      {charts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <figure key={c.id} className={clsx("rounded-xl border border-white/[0.07] bg-slate-900/40 p-4", (c.span === "full" || compact || charts.length === 1) && "lg:col-span-2")}>
              <figcaption className="mb-3">
                <div className="text-sm font-medium text-slate-100">{c.title}</div>
                {c.subtitle && <div className="text-xs text-slate-500">{c.subtitle}</div>}
              </figcaption>
              <ChartView spec={c} height={compact ? 220 : undefined} />
            </figure>
          ))}
        </div>
      )}

      {!compact && report.insights.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {report.insights.map((i, idx) => {
            const Icon = KIND_ICON[i.kind];
            return (
              <div key={idx} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1", TONE[i.tone ?? "neutral"])}>
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-100">{i.title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{i.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            {(
              [
                ["data", "Data", Table2],
                ["sql", "SQL", Code2],
                ["method", "How it was computed", Workflow],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(tab === key ? null : key)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition",
                  tab === key ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
            <a href={report.source.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-300">
              <Database className="h-3.5 w-3.5" />
              {report.source.name} · {report.asOf}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {tab === "data" && report.table.columns.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-wide text-slate-400 backdrop-blur">
                  <tr>
                    {report.table.columns.map((c) => (
                      <th key={c.key} className={clsx("px-3 py-2 font-medium", c.align === "right" && "text-right")}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
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
            <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-sky-200">{report.sql}</pre>
          )}
          {tab === "method" && (
            <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <ol className="space-y-2">
                {report.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-300">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-500/15 text-[11px] text-sky-300">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              {report.source.note && <p className="border-t border-white/[0.06] pt-3 text-xs text-slate-500">Source note: {report.source.note}</p>}
            </div>
          )}

          {report.followUps.length > 0 && onAsk && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Ask next:</span>
              {report.followUps.map((f) => (
                <button
                  key={f}
                  onClick={() => onAsk(f)}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300 transition hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-sky-200"
                >
                  {f}
                  <ChevronRight className="h-3 w-3" />
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
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className={clsx("rounded-md px-2 py-0.5 text-[11px]", c.strong ? "bg-sky-500/15 text-sky-300" : "bg-white/[0.05] text-slate-400")}>
          {c.label}
        </span>
      ))}
      <span className="text-[11px] text-slate-500">{Math.round(it.confidence * 100)}% match</span>
    </div>
  );
}

export function InsightCard({
  entry,
  onAsk,
  onRemove,
  pinned,
  onTogglePin,
}: {
  entry: Entry;
  onAsk: (q: string) => void;
  onRemove: () => void;
  pinned: boolean;
  onTogglePin: (r: InsightReport) => void;
}) {
  const [copied, setCopied] = useState(false);
  const uc = USE_CASE_BY_ID[entry.useCaseId];
  const report = entry.report;

  const copyLink = async () => {
    const url = `${window.location.origin}/?uc=${entry.useCaseId}&q=${encodeURIComponent(entry.question)}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article id={entry.id} className="scroll-mt-24 rounded-2xl border border-white/[0.08] bg-slate-900/50 p-5 shadow-xl shadow-black/20 backdrop-blur md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {uc && (
              <span className="flex items-center gap-1.5" style={{ color: uc.accent }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: uc.accent }} />
                {uc.name}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">{entry.question}</h2>
          {report && (
            <div className="mt-2">
              <InterpretationChips report={report} />
            </div>
          )}
        </div>
        {report && (
          <div className="flex items-center gap-1">
            <IconButton title={pinned ? "Unpin from dashboard" : "Pin to dashboard"} onClick={() => onTogglePin(report)} active={pinned}>
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </IconButton>
            <IconButton title="Download data as CSV" onClick={() => download(`${report.title.replace(/[^\w]+/g, "-").toLowerCase()}.csv`, toCsv(report))}>
              <Download className="h-4 w-4" />
            </IconButton>
            <IconButton title="Copy shareable link" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <LinkIcon className="h-4 w-4" />}
            </IconButton>
            <IconButton title="Remove" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      </header>

      {entry.status === "loading" && <Thinking startedAt={entry.startedAt} />}
      {entry.status === "error" && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          <TriangleAlert className="h-4 w-4" />
          {entry.error}
          <button onClick={onRemove} className="ml-auto text-xs text-rose-300 underline">
            Dismiss
          </button>
        </div>
      )}
      {report && <ReportBody report={report} onAsk={onAsk} />}
    </article>
  );
}

function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={clsx("grid h-8 w-8 place-items-center rounded-lg transition", active ? "bg-sky-500/15 text-sky-300" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100")}
    >
      {children}
    </button>
  );
}
