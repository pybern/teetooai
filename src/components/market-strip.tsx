import clsx from "clsx";
import type { MarketSummary } from "@/lib/market-summary";

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "#34d399" : "#f87171"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

export function MarketStrip({ summary }: { summary: MarketSummary }) {
  const asOf = new Date(summary.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Hong_Kong" });
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500">
        <span>HKEX snapshot · Yahoo Finance</span>
        <span>As of {asOf}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
        {summary.indices.map((i) => {
          const up = (i.changePct ?? 0) >= 0;
          return (
            <div key={i.symbol} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs text-slate-400">{i.name}</div>
                <div className="text-lg font-semibold tabular-nums text-white">{i.last.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
                <div className={clsx("text-xs tabular-nums", up ? "text-emerald-400" : "text-rose-400")}>{pct(i.changePct)}</div>
              </div>
              <Spark values={i.spark} up={i.spark.length > 1 && i.spark[i.spark.length - 1] >= i.spark[0]} />
            </div>
          );
        })}
        <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="mb-1.5 text-xs text-slate-400">Biggest movers today</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {summary.movers.map((m) => (
              <div key={m.symbol} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-slate-300">{m.name}</span>
                <span className={clsx("tabular-nums", m.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>{pct(m.changePct)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
