import { Database, LayoutDashboard, Sparkles } from "lucide-react";
import Link from "next/link";
import { USE_CASES } from "@/lib/usecases";
import { UseCaseIcon } from "./use-case-icon";

export function MobileNav() {
  return (
    <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-slate-950/80 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <Sparkles className="h-4 w-4 text-sky-400" /> Insightful
        </Link>
        <div className="ml-auto flex gap-1">
          <Link href="/dashboard" className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Dashboard">
            <LayoutDashboard className="h-4 w-4" />
          </Link>
          <Link href="/datasets" className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Data catalog">
            <Database className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {USE_CASES.map((u) => (
          <Link
            key={u.id}
            href={`/?uc=${u.id}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300"
          >
            <UseCaseIcon icon={u.icon} className="h-3.5 w-3.5" style={{ color: u.accent }} />
            {u.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
