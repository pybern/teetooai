"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme";

export type Theme = "light" | "dark";

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light",
  );
}

function setTheme(t: Theme) {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {}
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Color theme" className={`meta inline-flex border border-slate-700 ${className ?? ""}`}>
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          aria-pressed={theme === t}
          className={theme === t ? "bg-slate-800 px-2.5 py-1 text-white" : "px-2.5 py-1 text-slate-500 transition hover:text-slate-200"}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
