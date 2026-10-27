import clsx from "clsx";
import type { Insight, InsightSummary, Kpi } from "@/lib/types";

const TONE: Record<NonNullable<Insight["tone"]>, string> = {
  positive: "border-emerald-600",
  negative: "border-rose-600",
  warning: "border-amber-500",
  neutral: "border-slate-300",
};

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

export function KpiCard({ kpi, wrap = false }: { kpi: Kpi; wrap?: boolean }) {
  const deltaColor = kpi.good === undefined ? "text-slate-400" : kpi.good ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="min-w-0 bg-slate-950 px-4 py-3.5">
      <div className="meta truncate text-slate-500">{kpi.label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div title={kpi.value} className={clsx("min-w-0 font-semibold leading-none tracking-tight tabular-nums text-white", wrap ? "break-all text-[22px] sm:text-[28px]" : "truncate text-[28px]")}>{kpi.value}</div>
        {kpi.spark && <Sparkline values={kpi.spark} up={kpi.good} />}
      </div>
      {kpi.delta && (
        <div className={clsx("mt-2 truncate font-mono text-[11px] tabular-nums", deltaColor)}>{kpi.delta}</div>
      )}
      {kpi.hint && <div title={kpi.hint} className="mt-1 truncate text-[11px] text-slate-500">{kpi.hint}</div>}
    </div>
  );
}

export function InsightFindings({ insights }: { insights: Insight[] }) {
  return (
    <section className="reveal">
      <h3 className="meta mb-2 text-slate-500">Findings</h3>
      <ol className="grid gap-x-8 border-t border-slate-700 md:grid-cols-2">
        {insights.map((insight, index) => (
          <li key={index} className="grid min-w-0 grid-cols-[2rem_1fr] gap-2 border-b border-slate-700 py-3">
            <span className={clsx("meta border-l-2 pl-1.5 text-slate-500", TONE[insight.tone ?? "neutral"])}>{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0 break-words">
              <div className="text-sm font-semibold text-white">{insight.title}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{insight.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ResearchInsightSummary({ summary }: { summary: InsightSummary }) {
  return (
    <section aria-label={summary.title} className="my-4 min-w-0 space-y-4">
      <div>
        <h2 className="meta text-slate-500">{summary.title}</h2>
        <p className="mt-2 break-words text-lg font-semibold leading-snug text-white">{summary.headline}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{summary.scope}</p>
      </div>
      <div className="grid grid-cols-1 gap-px border border-slate-700 bg-slate-700 sm:grid-cols-2">
        {summary.kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} wrap />)}
      </div>
      <InsightFindings insights={summary.insights} />
    </section>
  );
}
