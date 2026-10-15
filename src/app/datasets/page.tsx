import { ArrowUpRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChartView } from "@/components/chart-view";
import { DATASETS } from "@/lib/data";
import { analyze } from "@/lib/engine/analyze";
import { fmt } from "@/lib/engine/format";
import type { ChartSpec, Dataset, Interpretation } from "@/lib/types";
import { USE_CASES } from "@/lib/usecases";

export const metadata: Metadata = { title: "Data catalog — Insightful" };

const KIND_LABEL: Record<Dataset["kind"], string> = {
  timeseries: "Time series",
  "cross-section": "Cross-section",
  panel: "Panel",
};

function previewInterpretation(ds: Dataset): Interpretation {
  const cross = ds.kind === "cross-section";
  return {
    question: ds.name,
    datasetId: ds.id,
    datasetName: ds.name,
    intent: cross ? "rank" : "trend",
    metrics: [ds.defaultMetric],
    entities: ds.kind === "panel" ? (ds.entities ?? []).slice(0, 5).map((e) => e.name) : [],
    topN: cross ? 10 : undefined,
    order: "desc",
    confidence: 1,
  };
}

async function getPreviews(): Promise<Record<string, ChartSpec | null>> {
  "use cache";
  return Object.fromEntries(DATASETS.map((ds) => [ds.id, analyze(previewInterpretation(ds), "explore").charts[0] ?? null]));
}

function askHref(ds: Dataset): string {
  const uc = USE_CASES.find((u) => u.id !== "explore" && u.datasetIds.includes(ds.id)) ?? USE_CASES.find((u) => u.id === "explore")!;
  const metric = ds.metrics.find((m) => m.key === ds.defaultMetric)!;
  const q = ds.kind === "cross-section" ? `Top 10 by ${metric.label.toLowerCase()}` : `${metric.label} trend`;
  return `/?uc=${uc.id}&q=${encodeURIComponent(q)}`;
}

export default async function DatasetsPage() {
  const previews = await getPreviews();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 md:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Data catalog</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {DATASETS.length} real datasets power every answer. The question router scores each one by metric, entity and keyword matches, then picks the best fit.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {DATASETS.map((ds) => {
          const preview = previews[ds.id];
          const sample = ds.rows.slice(-4).reverse();
          const cols = ds.metrics.slice(0, 3);
          return (
            <article key={ds.id} className="flex flex-col rounded-2xl border border-white/[0.08] bg-slate-900/50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-slate-300">{KIND_LABEL[ds.kind]}</span>
                    {ds.grain === "month" && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-slate-300">Monthly</span>}
                    <span className="text-slate-500">{ds.rows.length.toLocaleString()} rows · as of {ds.asOf}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-white">{ds.name}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{ds.description}</p>
                </div>
                <Link
                  href={askHref(ds)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-sky-400/50 hover:text-white"
                >
                  <Sparkles className="h-3 w-3" /> Ask
                </Link>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {ds.metrics.map((m) => (
                  <span key={m.key} title={m.description} className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
                    {m.label}
                  </span>
                ))}
              </div>

              {preview && (
                <div className="mt-4 rounded-xl bg-black/20 p-3">
                  <div className="mb-1 text-xs text-slate-400">{preview.title}</div>
                  <ChartView spec={preview} height={200} />
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      {ds.kind !== "timeseries" && <th className="py-1 pr-3 text-left font-medium">{ds.entityLabel ?? "Entity"}</th>}
                      {ds.kind !== "cross-section" && <th className="py-1 pr-3 text-left font-medium">Period</th>}
                      {cols.map((m) => (
                        <th key={m.key} className="py-1 pr-3 text-right font-medium">
                          {m.short ?? m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {sample.map((r, i) => (
                      <tr key={i} className="border-t border-white/[0.05]">
                        {ds.kind !== "timeseries" && <td className="py-1 pr-3">{r.entity}</td>}
                        {ds.kind !== "cross-section" && <td className="py-1 pr-3 tabular-nums">{r.label ?? r.year}</td>}
                        {cols.map((m) => (
                          <td key={m.key} className="py-1 pr-3 text-right tabular-nums">
                            {typeof r[m.key] === "number" ? fmt(r[m.key] as number, m.format) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <a
                href={ds.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto flex items-center gap-1 pt-4 text-xs text-slate-500 hover:text-slate-300"
              >
                Source: {ds.source.name} <ArrowUpRight className="h-3 w-3" />
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
