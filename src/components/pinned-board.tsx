"use client";

import { ExternalLink, LayoutDashboard, PinOff } from "lucide-react";
import Link from "next/link";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { InterpretationChips, ReportBody } from "./insight-card";
import { useInsights } from "./insight-store";

export function PinnedBoard() {
  const { hydrated, pinned, togglePin } = useInsights();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 md:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Answers you pinned from the workspace. Pins are saved in this browser.</p>
      </header>

      {!hydrated ? null : pinned.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 px-6 py-20 text-center">
          <LayoutDashboard className="h-10 w-10 text-slate-600" />
          <h2 className="mt-4 text-lg font-semibold text-white">Nothing pinned yet</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-400">Ask a question in the workspace and use the pin button on any answer to build your own board.</p>
          <Link href="/" className="mt-5 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400">
            Go to workspace
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {pinned.map((r) => {
            const uc = USE_CASE_BY_ID[r.useCaseId];
            return (
              <article key={r.id} className="rounded-2xl border border-white/[0.08] bg-slate-900/50 p-5">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {uc && (
                      <div className="text-xs" style={{ color: uc.accent }}>
                        {uc.name}
                      </div>
                    )}
                    <h2 className="mt-0.5 font-semibold text-white">{r.question}</h2>
                    <div className="mt-2">
                      <InterpretationChips report={r} />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link
                      href={`/?uc=${r.useCaseId}&q=${encodeURIComponent(r.question)}`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
                      title="Re-run in workspace"
                      aria-label="Re-run in workspace"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => togglePin(r)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-rose-300"
                      title="Unpin"
                      aria-label="Unpin"
                    >
                      <PinOff className="h-4 w-4" />
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
