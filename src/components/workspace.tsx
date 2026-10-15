"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { AskBar } from "./ask-bar";
import { InsightCard } from "./insight-card";
import { useInsights } from "./insight-store";
import { UseCaseIcon } from "./use-case-icon";

export function Workspace({ marketStrip }: { marketStrip?: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const uc = USE_CASE_BY_ID[params.get("uc") ?? "hk"] ?? USE_CASE_BY_ID.hk;
  const q = params.get("q");
  const { hydrated, entries, ask, remove, togglePin, isPinned } = useInsights();
  const autoRan = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated || !q || autoRan.current === q) return;
    autoRan.current = q;
    ask(q, uc.id);
    router.replace(`/?uc=${uc.id}`, { scroll: false });
  }, [hydrated, q, uc.id, ask, router]);

  useEffect(() => {
    if (!hydrated) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, [hydrated, params]);

  const onAsk = (question: string) => {
    ask(question, uc.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const feed = entries.filter((e) => e.useCaseId === uc.id);
  const otherCount = entries.length - feed.length;
  const busy = entries.some((e) => e.status === "loading");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 md:px-8">
      <section
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] p-6 md:p-8"
        style={{ background: `radial-gradient(120% 140% at 0% 0%, ${uc.accent}26 0%, transparent 55%), rgba(15,23,42,0.55)` }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: `${uc.accent}22`, color: uc.accent }}>
            <UseCaseIcon icon={uc.icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wider" style={{ color: uc.accent }}>
              Use case · {uc.persona}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white md:text-3xl">{uc.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{uc.scenario}</p>
          </div>
        </div>

        <div className="mt-6">
          <AskBar onAsk={onAsk} suggestions={uc.questions.map((x) => x.q)} accent={uc.accent} busy={busy} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {uc.questions.map((s) => (
            <button
              key={s.q}
              onClick={() => onAsk(s.q)}
              className="group flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1.5 pl-2 pr-3 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
            >
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${uc.accent}22`, color: uc.accent }}>
                {s.tag}
              </span>
              {s.q}
            </button>
          ))}
        </div>
      </section>

      {marketStrip && uc.id === "hk" && <div className="mt-5">{marketStrip}</div>}

      <div className="mt-6 space-y-6">
        {!hydrated ? null : feed.length === 0 ? (
          <EmptyState accent={uc.accent} first={uc.questions[0].q} onAsk={onAsk} otherCount={otherCount} />
        ) : (
          feed.map((e) => (
            <InsightCard
              key={e.id}
              entry={e}
              onAsk={onAsk}
              onRemove={() => remove(e.id)}
              pinned={!!e.report && isPinned(e.report.id)}
              onTogglePin={togglePin}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ accent, first, onAsk, otherCount }: { accent: string; first: string; onAsk: (q: string) => void; otherCount: number }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `${accent}1a`, color: accent }}>
        <Sparkles className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-white">Ask in plain English, get charts and findings</h2>
      <p className="mt-1 max-w-md text-sm text-slate-400">
        Each answer comes with KPIs, visualizations, ranked insights, the underlying table, and the SQL it would take to reproduce it.
      </p>
      <button
        onClick={() => onAsk(first)}
        className="mt-5 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-slate-950 transition hover:brightness-110"
        style={{ background: accent }}
      >
        Try “{first}”
        <ChevronRight className="h-4 w-4" />
      </button>
      {otherCount > 0 && <p className="mt-4 text-xs text-slate-500">{otherCount} answer{otherCount === 1 ? "" : "s"} saved under other use cases.</p>}
    </div>
  );
}
