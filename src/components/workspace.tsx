"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UseCase } from "@/lib/types";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { AskBar } from "./ask-bar";
import { ChatTurn } from "./insight-card";
import { useInsights } from "./insight-store";

export function Workspace({ marketStrip }: { marketStrip?: ReactNode }) {
  const params = useSearchParams();
  const uc = USE_CASE_BY_ID[params.get("uc") ?? "hk"] ?? USE_CASE_BY_ID.hk;
  return <ChatSession key={uc.id} uc={uc} q={params.get("q")} marketStrip={marketStrip} />;
}

function ChatSession({ uc, q, marketStrip }: { uc: UseCase; q: string | null; marketStrip?: ReactNode }) {
  const router = useRouter();
  const { hydrated, entries, pinned, ask, remove, settle, togglePin, isPinned } = useInsights();
  const autoRan = useRef<string | null>(null);
  const [sessionStart, setSessionStart] = useState(() => Date.now());

  useEffect(() => {
    if (!hydrated || !q || autoRan.current === q) return;
    autoRan.current = q;
    ask(q, uc.id);
    router.replace(`/?uc=${uc.id}`, { scroll: false });
  }, [hydrated, q, uc.id, ask, router]);

  const follow = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const near = window.innerHeight + y >= document.documentElement.scrollHeight - 160;
      // Only an upward scroll by the user releases follow mode; programmatic smooth scrolls pass through far-from-bottom positions.
      if (near) follow.current = true;
      else if (y < lastY - 4) follow.current = false;
      lastY = y;
      setAtBottom(near);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (follow.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const jumpToLatest = () => {
    follow.current = true;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  };

  const onAsk = (question: string) => {
    ask(question, uc.id);
    jumpToLatest();
  };
  const feed = entries.filter((e) => e.useCaseId === uc.id && e.startedAt >= sessionStart);
  const conversation = [...feed].reverse();
  const busy = entries.some((e) => e.status === "loading");
  const newSession = () => {
    setSessionStart(Date.now());
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex min-h-[calc(100dvh-6.5rem)] flex-col lg:min-h-screen">
      <header className="border-b border-slate-700 bg-slate-900 px-4 md:px-10 lg:sticky lg:top-0 lg:z-20">
        <div className="mx-auto flex min-h-12 w-full max-w-5xl items-center gap-3">
          <span className="meta min-w-0 flex-1 truncate text-slate-500">
            Agent chat <span className="px-1 text-slate-600">/</span>
            <span className="text-white">{uc.name}</span>
            <span className="hidden sm:inline">
              <span className="px-1 text-slate-600">/</span>
              {conversation.length} {conversation.length === 1 ? "query" : "queries"} this session
            </span>
          </span>
          {conversation.length > 0 && (
            <button
              onClick={newSession}
              className="meta flex min-h-8 shrink-0 items-center border border-slate-700 px-2.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              New session
            </button>
          )}
          <Link href="/dashboard" className="meta flex min-h-8 shrink-0 items-center gap-1.5 border border-slate-700 px-2.5 text-slate-300 transition hover:border-slate-500 hover:text-white">
            Dashboard <span className="tabular-nums text-slate-500">[{pinned.length}]</span>
          </Link>
        </div>
      </header>

      <div ref={threadRef} className="mx-auto w-full max-w-5xl flex-1 space-y-12 px-4 py-10 md:px-10">
        {hydrated && (
          <Greeting uc={uc} onAsk={onAsk} showPrompts={feed.length === 0}>
            {marketStrip && uc.id === "hk" ? marketStrip : null}
          </Greeting>
        )}
        {conversation.map((e, i) => (
          <ChatTurn
            key={e.id}
            entry={e}
            index={i + 1}
            onAsk={onAsk}
            onRemove={() => remove(e.id)}
            onSettled={settle}
            pinned={!!e.report && isPinned(e.report.id)}
            onTogglePin={togglePin}
          />
        ))}
      </div>

      <div className="sticky bottom-0 z-20 border-t border-slate-700 bg-slate-900 px-4 pb-3 pt-3 md:px-10">
        <div className="relative mx-auto w-full max-w-5xl">
          {!atBottom && conversation.length > 0 && (
            <button
              onClick={jumpToLatest}
              className="meta absolute -top-12 left-1/2 flex min-h-8 -translate-x-1/2 items-center border border-slate-600 bg-slate-950 px-3 text-slate-200 transition hover:border-slate-400 hover:text-white"
            >
              Jump to latest ↓
            </button>
          )}
          <AskBar onAsk={onAsk} suggestions={uc.questions.map((x) => x.q)} accent={uc.accent} busy={busy} placement="up" />
          <p className="meta mt-2 text-slate-500">Deterministic engine · curated datasets · every answer shows its tool calls, data and SQL</p>
        </div>
      </div>
    </div>
  );
}

function Greeting({
  uc,
  onAsk,
  showPrompts,
  children,
}: {
  uc: UseCase;
  onAsk: (q: string) => void;
  showPrompts: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="grid gap-x-3 md:grid-cols-[4rem_1fr]">
        <span className="meta pt-2 text-slate-500">Brief</span>
        <div className="min-w-0">
          <div className="meta text-slate-500">{uc.persona}</div>
          <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-white md:text-[40px]">{uc.name}</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-300">{uc.scenario}</p>
        </div>
      </div>
      {children}
      {showPrompts && (
        <div className="grid gap-x-3 md:grid-cols-[4rem_1fr]">
          <span className="meta pt-3 text-slate-500">Generate</span>
          <ol className="border-t border-slate-600">
            {uc.questions.map((s, i) => (
              <li key={s.q}>
                <button
                  onClick={() => onAsk(s.q)}
                  className="group grid w-full grid-cols-[2rem_7rem_1fr_auto] items-center gap-3 border-b border-slate-700 py-3 text-left transition hover:bg-slate-950"
                >
                  <span className="meta text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                  <span className="meta truncate text-slate-400">{s.tag}</span>
                  <span className="text-sm text-slate-200 group-hover:text-white">{s.q}</span>
                  <span className="meta text-slate-600 transition group-hover:text-slate-200">Generate</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {showPrompts && (
        <p className="meta text-slate-500 md:pl-[4.75rem]">Pick a prompt to generate an analysis, or write your own below</p>
      )}
    </section>
  );
}
