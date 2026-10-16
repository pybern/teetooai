"use client";

import Link from "next/link";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { InterpretationChips, ReportBody } from "./insight-card";
import { useInsights } from "./insight-store";

export function PinnedBoard() {
  const { hydrated, pinned, togglePin } = useInsights();
  const datasets = new Set(pinned.map((r) => r.interpretation.datasetId)).size;
  const useCases = new Set(pinned.map((r) => r.useCaseId)).size;
  const latest = pinned.reduce((m, r) => Math.max(m, r.createdAt), 0);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 md:px-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-700 pb-6">
        <div>
          <div className="meta text-slate-500">Workspace / Dashboard</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Answers pinned from the agent chat. Saved in this browser.</p>
        </div>
        <Link href="/" className="meta flex min-h-9 items-center bg-sky-500 px-4 text-[#ffffff] transition hover:bg-sky-600">
          Query the agent
        </Link>
      </header>

      {hydrated && pinned.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-px border border-slate-700 bg-slate-700 md:grid-cols-4">
          {[
            ["Pinned answers", String(pinned.length)],
            ["Datasets", String(datasets)],
            ["Use cases", String(useCases)],
            ["Last pinned", latest ? new Date(latest).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="bg-slate-950 px-4 py-3">
              <dt className="meta text-slate-500">{k}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-white">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {!hydrated ? null : pinned.length === 0 ? (
        <div className="border border-dashed border-slate-700 px-6 py-20 text-center">
          <div className="meta text-slate-500">0 pinned</div>
          <h2 className="mt-3 text-lg font-semibold text-white">Nothing pinned yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">Query the agent, then use “Pin to dashboard” under an answer to build this board.</p>
          <Link href="/" className="meta mt-5 inline-flex min-h-9 items-center bg-sky-500 px-4 text-[#ffffff] hover:bg-sky-600">
            Open agent chat
          </Link>
        </div>
      ) : (
        <div className="grid gap-px border border-slate-700 bg-slate-700 xl:grid-cols-2">
          {pinned.map((r) => {
            const uc = USE_CASE_BY_ID[r.useCaseId];
            return (
              <article key={r.id} className="min-w-0 bg-slate-950 p-5">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {uc && <div className="meta text-slate-500">{uc.name}</div>}
                    <h2 className="mt-1 font-semibold text-white">{r.question}</h2>
                    <div className="mt-2">
                      <InterpretationChips report={r} />
                    </div>
                  </div>
                  <div className="meta flex shrink-0 gap-1">
                    <Link
                      href={`/?uc=${r.useCaseId}&q=${encodeURIComponent(r.question)}`}
                      className="flex min-h-8 items-center border border-slate-700 px-2.5 text-slate-400 hover:border-slate-500 hover:text-white"
                    >
                      Re-run
                    </Link>
                    <button
                      onClick={() => togglePin(r)}
                      className="flex min-h-8 items-center border border-slate-700 px-2.5 text-slate-400 hover:border-slate-500 hover:text-white"
                    >
                      Unpin
                    </button>
                  </div>
                </header>
                <ReportBody report={r} compact />
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
