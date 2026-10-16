"use client";

import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { USE_CASES } from "@/lib/usecases";

const ALL_QUESTIONS = Array.from(new Set(USE_CASES.flatMap((u) => u.questions.map((q) => q.q))));

export function AskBar({
  onAsk,
  suggestions,
  accent,
  busy,
  placement = "down",
}: {
  onAsk: (q: string) => void;
  suggestions: string[];
  accent: string;
  busy?: boolean;
  placement?: "up" | "down";
}) {
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
        className="group flex items-center gap-3 border border-slate-700 bg-slate-950 py-1.5 pl-4 pr-1.5 transition focus-within:border-sky-400"
        style={{ ["--accent" as string]: accent }}
      >
        <span className="font-mono text-sm text-slate-500" aria-hidden>
          &gt;
        </span>
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
          placeholder="Query the insight agent…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-white placeholder:text-slate-600 focus:outline-none"
          aria-label="Ask a question"
        />
        <button
          type="submit"
          disabled={!value.trim() && cursor < 0}
          className={clsx("meta min-h-9 shrink-0 px-4 text-[#ffffff] transition hover:brightness-110 disabled:opacity-30", busy && "animate-pulse")}
          style={{ background: accent }}
        >
          {busy ? "Running" : "Run"}
        </button>
      </form>

      {open && matches.length > 0 && (
        <ul
          className={clsx(
            "absolute inset-x-0 z-30 overflow-hidden border border-slate-700 bg-slate-950 py-1 shadow-lg shadow-black/10",
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(m)}
                onMouseEnter={() => setCursor(i)}
                className={clsx("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", i === cursor ? "bg-slate-800 text-white" : "text-slate-300")}
              >
                <span className="flex-1">{m}</span>
                {i === cursor && <span className="meta text-slate-500">Enter</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
