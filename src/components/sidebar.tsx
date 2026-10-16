"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { USE_CASES } from "@/lib/usecases";
import { useInsights } from "./insight-store";
import { ThemeToggle } from "./theme";

const item = (active: boolean) =>
  clsx(
    "flex min-h-9 items-center gap-3 border-l-2 px-3 text-[13px] transition",
    active ? "border-sky-400 bg-slate-800 text-white" : "border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
  );

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const activeUc = params.get("uc") ?? "hk";
  const { entries, pinned, clear } = useInsights();
  const recent = entries
    .filter((e) => e.status === "done")
    .filter((e, i, all) => all.findIndex((x) => x.question === e.question && x.useCaseId === e.useCaseId) === i)
    .slice(0, 8);

  const nav = [
    { href: "/", label: "Agent chat", active: pathname === "/" },
    { href: "/dashboard", label: "Dashboard", active: pathname === "/dashboard", badge: pinned.length },
    { href: "/datasets", label: "Data catalog", active: pathname === "/datasets" },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-700 bg-slate-900 py-4 lg:flex">
      <Link href="/" className="mb-6 block px-5">
        <span className="block font-mono text-[13px] font-semibold uppercase tracking-[0.24em] text-white">Insightful</span>
        <span className="meta mt-0.5 block text-slate-500">Data research console</span>
      </Link>

      <div className="meta mb-1.5 px-5 text-slate-600">Workspace</div>
      <nav>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={item(n.active)}>
            <span className="flex-1">{n.label}</span>
            {n.badge !== undefined && <span className="font-mono text-[11px] tabular-nums text-slate-500">{n.badge}</span>}
          </Link>
        ))}
      </nav>

      <div className="meta mb-1.5 mt-6 px-5 text-slate-600">Use cases</div>
      <div>
        {USE_CASES.map((u, i) => (
          <Link key={u.id} href={`/?uc=${u.id}`} className={item(pathname === "/" && activeUc === u.id)}>
            <span className="font-mono text-[10.5px] text-slate-600">{String(i + 1).padStart(2, "0")}</span>
            <span className="truncate">{u.name}</span>
          </Link>
        ))}
      </div>

      <div className="mb-1.5 mt-6 flex items-center justify-between px-5">
        <span className="meta text-slate-600">Recent</span>
        {recent.length > 0 && (
          <button onClick={clear} className="meta text-slate-600 transition hover:text-slate-200">
            Clear
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <p className="px-5 text-xs text-slate-500">No queries yet.</p>
        ) : (
          recent.map((e) => (
            <Link
              key={e.id}
              href={`/?uc=${e.useCaseId}&q=${encodeURIComponent(e.question)}`}
              title="Run again"
              className="block border-l-2 border-transparent px-5 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
            >
              <span className="line-clamp-2">{e.question}</span>
            </Link>
          ))
        )}
      </div>

      <div className="mx-5 mt-4 flex items-center justify-between border-t border-slate-700 pt-3">
        <span className="meta text-slate-600">Theme</span>
        <ThemeToggle />
      </div>

      <div className="mx-5 mt-3 text-[11px] leading-relaxed text-slate-500">
        Sources: Yahoo Finance, World Bank, BLS, NOAA, NASA, Ember, IEA, SEC filings. Deterministic engine, no LLM calls.
      </div>
    </aside>
  );
}
