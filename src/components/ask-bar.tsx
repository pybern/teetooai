"use client";

import clsx from "clsx";
import { ArrowUp, CornerDownLeft, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { USE_CASES } from "@/lib/usecases";

const ALL_QUESTIONS = Array.from(new Set(USE_CASES.flatMap((u) => u.questions.map((q) => q.q))));

export function AskBar({ onAsk, suggestions, accent, busy }: { onAsk: (q: string) => void; suggestions: string[]; accent: string; busy?: boolean }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const v = value.trim().toLowerCase();
    if (!v) return suggestions.slice(0, 6);
    const words = v.split(/\s+/);
    const pool = [...suggestions, ...ALL_QUESTIONS.filter((q) => !suggestions.includes(q))];
    return pool.filter((q) => words.every((w) => q.toLowerCase().includes(w))).slice(0, 6);
  }, [value, suggestions]);

  const submit = (q: string) => {
    if (!q.trim()) return;
    onAsk(q);
    setValue("");
    setOpen(false);
    setCursor(-1);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(cursor >= 0 && open ? matches[cursor] : value);
        }}
        className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 shadow-2xl shadow-black/40 ring-1 ring-transparent backdrop-blur transition focus-within:border-white/20"
        style={{ ["--accent" as string]: accent }}
      >
        <Search className="h-5 w-5 shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={value}
          maxLength={300}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!open || matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => (c + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => (c <= 0 ? matches.length - 1 : c - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Ask a question about the data — e.g. “Which blue chips have the highest dividend yield?”"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-slate-500 focus:outline-none"
          aria-label="Ask a question"
        />
        <button
          type="submit"
          disabled={!value.trim() && cursor < 0}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white transition disabled:opacity-30"
          style={{ background: accent }}
          aria-label="Ask"
        >
          <ArrowUp className={clsx("h-4 w-4", busy && "animate-pulse")} />
        </button>
      </form>

      {open && matches.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 py-1 shadow-2xl backdrop-blur">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(m)}
                onMouseEnter={() => setCursor(i)}
                className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === cursor ? "bg-white/[0.06] text-white" : "text-slate-300")}
              >
                <Search className="h-3.5 w-3.5 text-slate-500" />
                <span className="flex-1">{m}</span>
                {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 text-slate-500" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
