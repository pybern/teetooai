import Link from "next/link";
import { USE_CASES } from "@/lib/usecases";
import { ThemeToggle } from "./theme";

export function MobileNav() {
  return (
    <div className="sticky top-0 z-20 border-b border-slate-700 bg-slate-900 lg:hidden">
      <div className="flex items-center gap-4 px-4 py-3">
        <Link href="/" className="font-mono text-[13px] font-semibold uppercase tracking-[0.24em] text-white">
          Insightful
        </Link>
        <div className="meta ml-auto flex gap-4 text-slate-400">
          <Link href="/dashboard" className="py-1 hover:text-white">
            Dashboard
          </Link>
          <Link href="/datasets" className="py-1 hover:text-white">
            Data
          </Link>
        </div>
        <ThemeToggle />
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {USE_CASES.map((u) => (
          <Link key={u.id} href={`/?uc=${u.id}`} className="shrink-0 border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white">
            {u.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
