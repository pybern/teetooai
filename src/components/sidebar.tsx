"use client";

import clsx from "clsx";
import { Clock, Database, LayoutDashboard, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { USE_CASES } from "@/lib/usecases";
import { useInsights } from "./insight-store";
import { UseCaseIcon } from "./use-case-icon";

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const activeUc = params.get("uc") ?? "hk";
  const { entries, pinned, clear } = useInsights();
  const recent = entries.filter((e) => e.status === "done").slice(0, 8);

  const nav = [
    { href: "/", label: "Workspace", icon: Sparkles, active: pathname === "/" },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/dashboard", badge: pinned.length || undefined },
    { href: "/datasets", label: "Data catalog", icon: Database, active: pathname === "/datasets" },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-white/[0.06] bg-slate-950/60 px-4 py-5 backdrop-blur lg:flex">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-sky-500 to-emerald-400 shadow-lg shadow-sky-500/20">
          <Sparkles className="h-5 w-5 text-white" />
        </span>
        <span>
          <span className="block text-[15px] font-semibold tracking-tight text-white">Insightful</span>
          <span className="block text-[11px] text-slate-400">Text → insight → visual</span>
        </span>
      </Link>

      <nav className="space-y-1">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
              n.active ? "bg-white/[0.08] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
            )}
          >
            <n.icon className="h-4 w-4" />
            <span className="flex-1">{n.label}</span>
            {n.badge ? <span className="rounded-full bg-sky-500/20 px-2 text-[11px] text-sky-300">{n.badge}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="mt-7 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">Use cases</div>
      <div className="mt-2 space-y-1">
        {USE_CASES.map((u) => {
          const active = pathname === "/" && activeUc === u.id;
          return (
            <Link
              key={u.id}
              href={`/?uc=${u.id}`}
              className={clsx(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-white/[0.08] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
              )}
            >
              <span className="grid h-7 w-7 place-items-center rounded-md" style={{ background: `${u.accent}1f`, color: u.accent }}>
                <UseCaseIcon icon={u.icon} className="h-4 w-4" />
              </span>
              <span className="truncate">{u.name}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-7 flex items-center justify-between px-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Recent</span>
        {recent.length > 0 && (
          <button onClick={clear} className="text-slate-500 transition hover:text-rose-400" title="Clear history">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {recent.length === 0 ? (
          <p className="px-3 text-xs text-slate-500">Your questions will show up here.</p>
        ) : (
          recent.map((e) => (
            <Link
              key={e.id}
              href={`/?uc=${e.useCaseId}#${e.id}`}
              className="flex items-start gap-2 rounded-md px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
            >
              <Clock className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{e.question}</span>
            </Link>
          ))
        )}
      </div>

      <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-500">
        Real data from Yahoo Finance, World Bank, BLS, NOAA, NASA, Ember, IEA and SEC filings. Analysis runs on a deterministic engine — no LLM calls.
      </div>
    </aside>
  );
}
