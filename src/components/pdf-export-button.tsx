"use client";

import { useState, type RefObject } from "react";
import { exportChatPdf } from "@/lib/export-chat-pdf";
import type { InsightReport } from "@/lib/types";

export function PdfExportButton({ target, title, reports = [], disabled = false }: {
  target: RefObject<HTMLElement | null>;
  title: string;
  reports?: InsightReport[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function exportPdf() {
    if (!target.current || busy || disabled) return;
    setBusy(true); setError("");
    try { await exportChatPdf(target.current, title, reports); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not prepare the PDF. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="shrink-0">
    <button type="button" onClick={exportPdf} disabled={disabled || busy} className="min-h-10 border border-slate-600 px-3 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? "Preparing PDF..." : "Export PDF"}
    </button>
    {error && <p role="alert" className="mt-2 max-w-xs text-xs text-rose-300">{error}</p>}
  </div>;
}
