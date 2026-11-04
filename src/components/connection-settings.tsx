"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { AdminTokenGenerator } from "./admin-token-generator";
import { ModelChat } from "./model-chat";
import { DatabaseInitializer } from "./database-initializer";
import { sendModelChat } from "@/lib/model-chat-stream";
import {
  DEFAULT_CONNECTIONS, isVercelAiGateway, type ApiSettings, type DatabaseSettings,
  type PublicConnections, type ConnectionTestResult,
  type DatabaseInitializationResult,
  modelReasoningEfforts, isReasoningEffort, type ModelCatalog,
  DEFAULT_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, OUTPUT_TOKEN_STEPS, type OutputTokenStep,
} from "@/lib/connections";

type Kind = "api" | "database";
type Notice = { error: string } | { saved: true } | ConnectionTestResult;
const inputClass = "mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500";
const OUTPUT_TOKEN_LABELS: Record<OutputTokenStep, { label: string; hint: string }> = {
  planning: { label: "Planning", hint: "Writes the research plan and SQL." },
  chart: { label: "Chart choice", hint: "Decides whether SQL results get a chart, after the answer." },
  explanation: { label: "Explanation", hint: "Explain these results, on request." },
};
const buttonClass = "min-h-10 border border-slate-600 px-4 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white disabled:cursor-wait disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-sm text-slate-300">
      {label}
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

function Feedback({ notice }: { notice?: Notice }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {notice && (
        <div className={`mt-5 border-l-2 p-3 text-sm ${"error" in notice ? "border-rose-600 bg-rose-600/5 text-rose-300" : "border-emerald-600 bg-emerald-600/5 text-emerald-300"}`}>
          {"error" in notice ? notice.error : "saved" in notice ? "Settings saved on the server. Saving does not verify connectivity." : (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <span>{notice.message}</span>
                <span className="font-mono text-xs">{notice.durationMs} ms</span>
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{notice.feedback}</pre>
              <p className="mt-2 text-xs">Tested the current form values. Save separately to persist them.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

async function request<T>(token: string, url: string, method: string, body?: unknown, signal?: AbortSignal, timeoutMs = 40000): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  let result;
  try { result = await response.json(); } catch {
    throw new Error(`Server returned HTTP ${response.status} without a JSON response.`);
  }
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Request failed (HTTP ${response.status}).`);
  return result as T;
}

export function ConnectionSettings() {
  const modelListId = useId();
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState("");
  const [api, setApi] = useState<ApiSettings>({ ...DEFAULT_CONNECTIONS.api, apiKey: undefined });
  const [database, setDatabase] = useState<DatabaseSettings>({ ...DEFAULT_CONNECTIONS.database, password: undefined });
  const [hasKey, setHasKey] = useState(false);
  const [environmentKeyAvailable, setEnvironmentKeyAvailable] = useState(false);
  const usesEnvironmentKey = environmentKeyAvailable && isVercelAiGateway(api.baseUrl);
  const [hasPassword, setHasPassword] = useState(false);
  const [notices, setNotices] = useState<Partial<Record<Kind, Notice>>>({});
  const [dirty, setDirty] = useState({ api: false, database: false });
  const [models, setModels] = useState<string[]>([]);
  const [reasoningEfforts, setReasoningEfforts] = useState<ModelCatalog["reasoningEfforts"]>({});
  const availableEfforts = modelReasoningEfforts({ models, reasoningEfforts }, api.model);
  const [modelError, setModelError] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelRefresh, setModelRefresh] = useState(0);
  const [savedApi, setSavedApi] = useState({ baseUrl: DEFAULT_CONNECTIONS.api.baseUrl, model: DEFAULT_CONNECTIONS.api.model });
  const [chatRevision, setChatRevision] = useState(0);
  const [savedDatabase, setSavedDatabase] = useState({
    host: DEFAULT_CONNECTIONS.database.host, port: DEFAULT_CONNECTIONS.database.port, database: DEFAULT_CONNECTIONS.database.database,
  });
  const [databaseRevision, setDatabaseRevision] = useState(0);

  useEffect(() => {
    if (!unlocked) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setModelsLoading(true);
      setModelError("");
      try {
        const result = await request<ModelCatalog>(token, "/api/config/models", "POST", {
          settings: { baseUrl: api.baseUrl, apiKey: api.apiKey },
        }, controller.signal);
        if (!controller.signal.aborted) {
          setModels(result.models);
          setReasoningEfforts(result.reasoningEfforts ?? {});
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setModelError(error instanceof Error ? error.message : "Could not load the model catalog. Enter a model ID manually.");
        }
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [unlocked, token, api.baseUrl, api.apiKey, modelRefresh]);

  function updateApi(change: Partial<ApiSettings>) {
    setApi((current) => ({
      ...current, ...change,
      ...(("model" in change && change.model !== current.model) || ("baseUrl" in change && change.baseUrl !== current.baseUrl)
        ? { reasoningEffort: undefined } : {}),
    }));
    setNotices((current) => ({ ...current, api: undefined }));
    setDirty((current) => ({ ...current, api: true }));
    if ("baseUrl" in change || "apiKey" in change) {
      setModels([]);
      setReasoningEfforts({});
      setModelError("");
    }
  }
  function updateDatabase(change: Partial<DatabaseSettings>) {
    setDatabase((current) => ({ ...current, ...change }));
    setNotices((current) => ({ ...current, database: undefined }));
    setDirty((current) => ({ ...current, database: true }));
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy("unlock");
    setUnlockError("");
    try {
      const saved = await request<PublicConnections>(token, "/api/config", "GET");
      setApi({ baseUrl: saved.api.baseUrl, model: saved.api.model, reasoningEffort: saved.api.reasoningEffort, outputTokens: saved.api.outputTokens, apiKey: undefined });
      setSavedApi({ baseUrl: saved.api.baseUrl, model: saved.api.model });
      const { hasPassword: storedPassword, ...db } = saved.database;
      setDatabase({ ...db, password: undefined });
      setSavedDatabase({ host: db.host, port: db.port, database: db.database });
      setHasKey(saved.api.hasApiKey);
      setEnvironmentKeyAvailable(saved.api.environmentApiKeyAvailable ?? false);
      setHasPassword(storedPassword);
      setDirty({ api: false, database: false });
      setNotices({});
      setUnlocked(true);
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "Could not load settings.");
    } finally { setBusy(null); }
  }

  async function action(kind: Kind, test: boolean) {
    setBusy(`${kind}-${test ? "test" : "save"}`);
    setNotices((current) => ({ ...current, [kind]: undefined }));
    try {
      const body = { kind, settings: kind === "api" ? api : database };
      if (test) {
        const result = await request<ConnectionTestResult>(token, "/api/config/test", "POST", body);
        setNotices((current) => ({ ...current, [kind]: result }));
      } else {
        const result = await request<PublicConnections>(token, "/api/config", "PUT", body);
        setEnvironmentKeyAvailable(result.api.environmentApiKeyAvailable ?? false);
        if (kind === "api") {
          setHasKey(result.api.hasApiKey);
          setApi({ baseUrl: result.api.baseUrl, model: result.api.model, reasoningEffort: result.api.reasoningEffort, outputTokens: result.api.outputTokens, apiKey: undefined });
          setSavedApi({ baseUrl: result.api.baseUrl, model: result.api.model });
          setChatRevision((current) => current + 1);
        } else {
          const { hasPassword: storedPassword, ...db } = result.database;
          setHasPassword(storedPassword);
          setDatabase({ ...db, password: undefined });
          setSavedDatabase({ host: db.host, port: db.port, database: db.database });
          setDatabaseRevision((current) => current + 1);
        }
        setDirty((current) => ({ ...current, [kind]: false }));
        setNotices((current) => ({ ...current, [kind]: { saved: true } }));
      }
    } catch (error) {
      setNotices((current) => ({ ...current, [kind]: { error: error instanceof Error ? error.message : "Connection operation failed." } }));
    } finally { setBusy(null); }
  }

  function lock() {
    setToken("");
    setUnlocked(false);
    setEnvironmentKeyAvailable(false);
    setApi({ ...DEFAULT_CONNECTIONS.api, apiKey: undefined });
    setDatabase({ ...DEFAULT_CONNECTIONS.database, password: undefined });
    setNotices({});
    setModels([]);
    setReasoningEfforts({});
    setModelError("");
    setModelsLoading(false);
  }

  async function initializeDatabase() {
    setBusy("database-initialize");
    try {
      return await request<DatabaseInitializationResult>(token, "/api/config/database/initialize", "POST", { confirm: true }, undefined, 150000);
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
        throw new Error("Initialization response timed out. Check the database state before retrying; the transaction outcome could not be confirmed.");
      }
      throw error;
    } finally { setBusy(null); }
  }

  if (!unlocked) {
    return (
      <form onSubmit={unlock} className="max-w-xl border border-slate-700 bg-slate-950 p-5 md:p-6">
        <div className="meta text-slate-500">Administrator access</div>
        <h2 className="mt-2 text-lg font-semibold text-white">Unlock connection settings</h2>
        <p className="mb-5 mt-2 text-sm leading-relaxed text-slate-400">
          Set <code>CONFIG_ADMIN_TOKEN</code> (at least 32 characters) in the server environment, then enter it here.
          The token is held only in memory for this page.
        </p>
        <Field label="Administrator token">
          <input className={inputClass} type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} disabled={!!busy} />
        </Field>
        <button className={`${buttonClass} mt-5`} disabled={!!busy} type="submit">{busy ? "Loading settings..." : "Unlock settings"}</button>
        {unlockError && <p role="alert" className="mt-4 text-sm text-rose-300">{unlockError}</p>}
        <AdminTokenGenerator />
      </form>
    );
  }

  function buttons(kind: Kind) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} onClick={() => action(kind, true)}>
          {busy === `${kind}-test` ? "Waiting for feedback..." : "Test connection"}
        </button>
        <button type="submit" className={`${buttonClass} border-sky-500 text-sky-300`}>
          {busy === `${kind}-save` ? "Saving..." : "Save settings"}
        </button>
        <span className="meta text-slate-500">{dirty[kind] ? "Unsaved changes" : "Current values"}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 border-b border-slate-700 pb-5">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-400">
          Credentials are stored only on the server and never returned to the browser.
          API/model settings move to PostgreSQL after database initialization; the database connection stays in the private server bootstrap file.
          Known defaults are prefilled; saved settings take precedence.
          Leave a secret field untouched to keep its saved value; use Remove to clear it.
          Tests use current form values and do not save them.
        </p>
        <button type="button" className="meta shrink-0 text-slate-400 hover:text-white disabled:opacity-50" onClick={lock} disabled={!!busy}>Lock settings</button>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void action("api", false); }} className="border border-slate-700 bg-slate-950 p-5 md:p-6">
        <fieldset disabled={!!busy} aria-busy={busy?.startsWith("api") ?? false}>
          <legend className="meta text-slate-500">01 / Model endpoint</legend>
          <h2 className="mt-2 text-xl font-semibold text-white">OpenAI-compatible API</h2>
          <p className="mb-6 mt-2 text-sm text-slate-400">Sends a small chat completion. Success requires actual, non-empty assistant feedback, not just HTTP 200.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="API base URL" hint="Include the version prefix (for example /v1), not /chat/completions. Local endpoints are supported.">
                <input className={inputClass} type="url" required value={api.baseUrl} onChange={(e) => updateApi({ baseUrl: e.target.value })} placeholder={DEFAULT_CONNECTIONS.api.baseUrl} />
              </Field>
            </div>
            <div className="min-w-0 space-y-4 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-300">Provider model catalog</p>
                <button type="button" className={buttonClass} disabled={modelsLoading} onClick={() => setModelRefresh((current) => current + 1)}>
                  {modelsLoading ? "Loading models..." : models.length ? "Refresh models" : "Load models"}
                </button>
              </div>
              <Field label="Model" hint="Type to search, select a suggestion, or enter a custom model ID. Clear the field to browse all models. Qwen is listed under alibaba on Vercel.">
                <input
                  aria-label="Model"
                  className={inputClass}
                  list={modelListId}
                  autoComplete="off"
                  required
                  value={api.model}
                  onChange={(e) => updateApi({ model: e.target.value })}
                  placeholder="Search models or enter a model ID"
                />
              </Field>
              <datalist id={modelListId}>
                {models.map((id) => <option key={id} value={id} label={id.startsWith("alibaba/") ? `${id} (Alibaba / Qwen)` : id} />)}
              </datalist>
              {(availableEfforts.length > 0 || api.reasoningEffort) ? (
                <Field label="Thinking effort" hint="Provider default sends no effort override. Higher effort can increase latency and cost; the configuration chat keeps its 60-second timeout and 1,024-token output budget, and research uses the output-token limits below. Save to apply.">
                  <select
                    aria-label="Thinking effort"
                    className={inputClass}
                    value={api.reasoningEffort ?? ""}
                    onChange={(event) => updateApi({ reasoningEffort: isReasoningEffort(event.target.value) ? event.target.value : undefined })}
                  >
                    <option value="">Provider default</option>
                    {api.reasoningEffort && !availableEfforts.includes(api.reasoningEffort) && (
                      <option value={api.reasoningEffort} disabled>{api.reasoningEffort} (support not verified; refresh models or choose Provider default)</option>
                    )}
                    {availableEfforts.map((effort) => <option key={effort} value={effort}>{effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1)}</option>)}
                  </select>
                </Field>
              ) : <p className="text-xs text-slate-500">Thinking effort uses the provider default. A selector appears when the selected model&apos;s catalog advertises effort controls.</p>}
              <fieldset className="min-w-0">
                <legend className="text-sm text-slate-300">Research output-token limits</legend>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Maximum tokens each research model call may generate, including thinking. Leave blank for the default ({DEFAULT_OUTPUT_TOKENS.planning.toLocaleString("en-US")}).
                  Higher limits allow more thinking but can increase cost and latency. Save to apply.
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {OUTPUT_TOKEN_STEPS.map((step) => (
                    <Field key={step} label={OUTPUT_TOKEN_LABELS[step].label} hint={OUTPUT_TOKEN_LABELS[step].hint}>
                      <input
                        aria-label={`${OUTPUT_TOKEN_LABELS[step].label} output-token limit`}
                        className={inputClass}
                        type="number"
                        inputMode="numeric"
                        min={MIN_OUTPUT_TOKENS}
                        max={MAX_OUTPUT_TOKENS}
                        step={1}
                        value={api.outputTokens?.[step] ?? ""}
                        placeholder={String(DEFAULT_OUTPUT_TOKENS[step])}
                        onChange={(event) => {
                          const rest = { ...api.outputTokens };
                          delete rest[step];
                          const value = event.target.value === "" ? undefined : Number(event.target.value);
                          updateApi({ outputTokens: value === undefined ? rest : { ...rest, [step]: value } });
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
              <div aria-live="polite" className="text-xs leading-relaxed text-slate-500">
                {modelError ? <p role="alert" className="text-rose-300">{modelError}</p> : modelsLoading ? "Fetching the provider's live catalog..." : models.length ? (
                  <p>{models.length} models available. All catalog models are included; image, audio or embedding models may not support the chat connection test.</p>
                ) : "Models load automatically using the current base URL and API key. No selected model or save is required."}
              </div>
            </div>
            <div>
              <Field label="API key" hint={usesEnvironmentKey ? "Using server AI_GATEWAY_API_KEY for Vercel AI Gateway. It overrides the configured key; Test connection verifies access." : hasKey ? "A key is saved on the server." : "Optional for local or unauthenticated providers."}>
                <input className={inputClass} type="password" autoComplete="new-password" disabled={usesEnvironmentKey} value={api.apiKey ?? ""} onChange={(e) => updateApi({ apiKey: e.target.value })} placeholder={usesEnvironmentKey ? "Using server environment key" : hasKey && api.apiKey === undefined ? "Saved key (unchanged)" : "API key"} />
              </Field>
              <button type="button" className="mt-2 text-xs text-slate-400 underline hover:text-white" onClick={() => updateApi({ apiKey: "" })}>Remove key on save</button>
              {api.apiKey === "" && !usesEnvironmentKey && <p className="mt-1 text-xs text-amber-400">The current form has no API key.</p>}
            </div>
          </div>
          <p className="mt-5 text-xs text-slate-500">The test may incur a small provider charge. Uses POST /chat/completions with a 15-second timeout.</p>
          {buttons("api")}
          <Feedback notice={notices.api} />
        </fieldset>
      </form>

      <ModelChat
        key={`chat-${chatRevision}`}
        model={savedApi.model}
        baseUrl={savedApi.baseUrl}
        unsavedChanges={dirty.api}
        disabled={!!busy}
        onSend={(messages, signal, onText, onReasoning) => sendModelChat(token, messages, signal, onText, onReasoning)}
      />

      <form onSubmit={(event) => { event.preventDefault(); void action("database", false); }} className="border border-slate-700 bg-slate-950 p-5 md:p-6">
        <fieldset disabled={!!busy} aria-busy={busy?.startsWith("database") ?? false}>
          <legend className="meta text-slate-500">02 / Database</legend>
          <h2 className="mt-2 text-xl font-semibold text-white">PostgreSQL</h2>
          <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400">
            Direct PostgreSQL for PlanetScale or another provider. The test opens a real connection and runs a read-only SELECT; it does not create or modify tables.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Host or IP address" hint="For PlanetScale, use the provider hostname so TLS identity verification works.">
              <input className={inputClass} required value={database.host} onChange={(e) => updateDatabase({ host: e.target.value })} placeholder="db.example.com or 10.0.0.5" />
            </Field>
            <Field label="Port">
              <input className={inputClass} type="number" min={1} max={65535} step={1} required value={database.port || ""} onChange={(e) => updateDatabase({ port: Number(e.target.value) })} />
            </Field>
            <Field label="Database name">
              <input className={inputClass} required value={database.database} onChange={(e) => updateDatabase({ database: e.target.value })} placeholder="Database name" />
            </Field>
            <Field label="Username">
              <input className={inputClass} autoComplete="off" required value={database.username} onChange={(e) => updateDatabase({ username: e.target.value })} placeholder="Database user" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Password" hint={hasPassword ? "A password is saved on the server." : "Use a least-privilege database account."}>
                <input className={inputClass} type="password" autoComplete="new-password" value={database.password ?? ""} onChange={(e) => updateDatabase({ password: e.target.value })} placeholder={hasPassword && database.password === undefined ? "Saved password (unchanged)" : "Database password"} />
              </Field>
              <button type="button" className="mt-2 text-xs text-slate-400 underline hover:text-white" onClick={() => updateDatabase({ password: "" })}>Remove password on save</button>
              {database.password === "" && <p className="mt-1 text-xs text-amber-400">The current form has no password.</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input type="checkbox" checked={database.ssl} onChange={(e) => updateDatabase({ ssl: e.target.checked, ...(e.target.checked ? {} : { caCertificate: "" }) })} className="size-4 accent-sky-500" />
                Require TLS with certificate verification (recommended)
              </label>
              {!database.ssl && <p className="mt-2 text-xs text-amber-400">TLS is disabled. Credentials and queries may travel unencrypted. Use only on a trusted local network.</p>}
            </div>
            {database.ssl && (
              <div className="sm:col-span-2">
                <Field label="CA certificate (optional)" hint="PEM format. Leave blank to use the system trust store. Certificate verification is never disabled.">
                  <textarea className={`${inputClass} font-mono text-xs`} rows={4} value={database.caCertificate} onChange={(e) => updateDatabase({ caCertificate: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----" />
                </Field>
              </div>
            )}
          </div>
          {buttons("database")}
          <Feedback notice={notices.database} />
        </fieldset>
      </form>
      <DatabaseInitializer
        key={`database-${databaseRevision}`}
        target={savedDatabase}
        unsavedChanges={dirty.database}
        disabled={!!busy}
        onInitialize={initializeDatabase}
      />
      <p className="text-xs leading-relaxed text-slate-500">
        Connections originate from the Next.js server, not your browser. Private IPs must be reachable from that server.
        Settings are shared by this deployment; they are not per-browser preferences.
      </p>
    </div>
  );
}
