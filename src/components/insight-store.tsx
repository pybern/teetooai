"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { InsightReport } from "@/lib/types";

export type Entry = {
  id: string;
  question: string;
  useCaseId: string;
  status: "loading" | "done" | "error";
  startedAt: number;
  report?: InsightReport;
  error?: string;
  live?: boolean;
  plan?: number[];
};

type Store = {
  hydrated: boolean;
  entries: Entry[];
  pinned: InsightReport[];
  ask: (question: string, useCaseId: string) => void;
  remove: (id: string) => void;
  settle: (id: string) => void;
  clear: () => void;
  togglePin: (report: InsightReport) => void;
  isPinned: (id: string) => boolean;
};

const KEY = "insightful:v1";
const MAX_ENTRIES = 25;
// Base duration (ms) of each agent step; jittered per request so runs don't look canned.
const STEP_MS = [450, 650, 850, 1300, 650, 900];

const Ctx = createContext<Store | null>(null);

export function InsightStoreProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pinned, setPinned] = useState<InsightReport[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { entries?: Entry[]; pinned?: InsightReport[] };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount avoids SSR mismatch
        setEntries((saved.entries ?? []).filter((e) => e.status === "done"));
        setPinned(saved.pinned ?? []);
      }
    } catch {
      localStorage.removeItem(KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const done = entries
      .filter((e) => e.status === "done")
      .slice(0, MAX_ENTRIES)
      .map((e) => ({ ...e, live: undefined, plan: undefined }));
    try {
      localStorage.setItem(KEY, JSON.stringify({ entries: done, pinned }));
    } catch {
      localStorage.setItem(KEY, JSON.stringify({ entries: done.slice(0, 5), pinned: pinned.slice(0, 10) }));
    }
  }, [entries, pinned, hydrated]);

  const ask = useCallback((question: string, useCaseId: string) => {
    const q = question.trim();
    if (!q) return;
    const id = `e${Date.now()}-${seq.current++}`;
    const plan = STEP_MS.map((ms) => Math.round(ms * (0.7 + Math.random() * 0.7)));
    setEntries((prev) => [{ id, question: q, useCaseId, status: "loading", startedAt: Date.now(), live: true, plan }, ...prev]);
    const minDelay = new Promise((r) => setTimeout(r, plan.reduce((a, b) => a + b, 0)));
    fetch("/api/insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, useCaseId }),
    })
      .then(async (res) => {
        const body = (await res.json()) as { report?: InsightReport; error?: string };
        if (!res.ok || !body.report) throw new Error(body.error ?? `Request failed (${res.status})`);
        await minDelay;
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "done", report: body.report } : e)));
      })
      .catch(async (err: unknown) => {
        await minDelay;
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "error", error: err instanceof Error ? err.message : "Something went wrong" } : e)));
      });
  }, []);

  const remove = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), []);
  const settle = useCallback((id: string) => setEntries((prev) => prev.map((e) => (e.id === id && e.live ? { ...e, live: false } : e))), []);
  const clear = useCallback(() => setEntries([]), []);
  const togglePin = useCallback((report: InsightReport) => {
    setPinned((prev) => (prev.some((p) => p.id === report.id) ? prev.filter((p) => p.id !== report.id) : [report, ...prev]));
  }, []);
  const isPinned = useCallback((id: string) => pinned.some((p) => p.id === id), [pinned]);

  const value = useMemo(
    () => ({ hydrated, entries, pinned, ask, remove, settle, clear, togglePin, isPinned }),
    [hydrated, entries, pinned, ask, remove, settle, clear, togglePin, isPinned],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInsights(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInsights must be used inside InsightStoreProvider");
  return ctx;
}
