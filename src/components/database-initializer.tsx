"use client";

import { useRef, useState } from "react";
import type { DatabaseInitializationResult } from "@/lib/connections";

type Props = {
  target: { host: string; port: number; database: string };
  unsavedChanges: boolean;
  disabled: boolean;
  onInitialize: () => Promise<DatabaseInitializationResult>;
};

export function DatabaseInitializer({ target, unsavedChanges, disabled, onInitialize }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DatabaseInitializationResult | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const configured = Boolean(target.host && target.database);

  async function initialize() {
    if (!confirmed || inFlight.current || disabled || unsavedChanges || !configured) return;
    inFlight.current = true;
    setRunning(true);
    setResult(null);
    setError("");
    try {
      setResult(await onInitialize());
      setConfirmed(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Database initialization failed. Check the database state before retrying.");
    } finally { inFlight.current = false; setRunning(false); }
  }

  return (
    <section aria-label="Database initialization" className="border border-slate-700 bg-slate-950 p-5 md:p-6">
      <div className="meta text-slate-500">Database setup / Explicit write operation</div>
      <h2 className="mt-2 text-xl font-semibold text-white">Initialize database</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Create missing Insightful tables in the public schema and seed them with the curated datasets and bundled HKEX short-selling records.
        Migrate file-based API/model settings into the configuration table when it is created.
        Existing dataset tables are skipped entirely, even if empty. Existing configuration values are kept;
        only a missing API settings row is imported. The table catalog is refreshed; no other existing rows are overwritten or deleted.
        All changes run in one transaction.
      </p>
      <p className="mt-3 break-words font-mono text-xs text-slate-300">
        {configured ? `Saved target: ${target.database} at ${target.host}:${target.port}` : "Save a PostgreSQL connection above before initializing."}
      </p>
      <ul className="mt-3 space-y-1 text-xs text-slate-500">
        <li>public.insightful_datasets: dataset catalog and source metadata</li>
        <li>public.insightful_dataset_rows: curated observations</li>
        <li>public.insightful_hkex_short_selling: dated records, currency and source URLs</li>
        <li>public.insightful_table_catalog: searchable table descriptions, columns and sample rows for the research agent (refreshed each run)</li>
        <li>public.insightful_configuration: private API/model settings and saved API key</li>
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Requires CREATE permission on public. HKEX coverage is partial; missing dates are not filled.
        Monetary values retain their trading currency. Initialization does not switch the analysis engine to database queries.
        Allow up to two minutes; keep this page open. Confirm HKEX data usage rights before importing.
      </p>
      {unsavedChanges && <p className="mt-3 text-xs text-amber-400">Save your database changes before initializing so the displayed target matches your intended database.</p>}
      <label className="mt-5 flex items-start gap-3 text-sm text-slate-300">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-sky-500"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={disabled || running || !configured || unsavedChanges}
        />
        I confirm creating and seeding missing tables in this saved database.
      </label>
      <button
        type="button"
        className="mt-4 min-h-10 border border-sky-500 px-4 text-sm text-sky-300 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!confirmed || disabled || running || !configured || unsavedChanges}
        onClick={initialize}
      >
        {running ? "Initializing database..." : "Initialize database"}
      </button>
      {running && <p role="status" className="mt-3 text-xs text-slate-400">Creating and importing missing tables. No changes are reported as complete until the transaction commits.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
      {result && (
        <div role="status" className="mt-5 border-l-2 border-emerald-600 pl-4">
          <p className="text-sm text-emerald-300">Initialization committed in {result.durationMs} ms.</p>
          <ul className="mt-3 space-y-2 text-xs text-slate-300">
            {result.tables.map((table) => (
              <li key={table.name} className="break-words">
                <span className="font-mono">{table.name}</span>
                {table.status === "created" ? `: created and seeded ${table.insertedRows.toLocaleString("en-US")} rows`
                  : table.status === "seeded" ? `: imported ${table.insertedRows.toLocaleString("en-US")} missing settings rows`
                    : ": already exists, left untouched"}
              </li>
            ))}
          </ul>
          {result.hkexCoverage && <p className="mt-3 text-xs text-slate-400">
            HKEX: {result.hkexCoverage.from} through {result.hkexCoverage.to}; {result.hkexCoverage.records.toLocaleString("en-US")} records;
            currencies {result.hkexCoverage.currencies.join(", ")}. This is not a complete historical trading calendar.
          </p>}
        </div>
      )}
    </section>
  );
}
