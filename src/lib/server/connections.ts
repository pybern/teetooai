import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { APICallError, createUIMessageStream, createUIMessageStreamResponse, streamText, type UIMessage, type LanguageModel, type TextStreamPart, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  DEFAULT_CONNECTIONS, isVercelAiGateway, type ApiSettings, type Connections, type ConnectionTestResult,
  isReasoningEffort, modelReasoningEfforts, type ModelCatalog, type ReasoningEffort,
  type DatabaseSettings, type PublicConnections,
  MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_TOTAL_CHARS, type ModelChatMessage, type ModelChatMetadata, type ModelChatToolActivity,
  HKEX_SERVER_TIMEOUT_MS, isOutputTokenLimit, MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, OUTPUT_TOKEN_STEPS, outputTokenLimit, type OutputTokenLimits,
} from "@/lib/connections";

export class ConnectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function authorizeConfiguration(request: Request) {
  const expected = process.env.CONFIG_ADMIN_TOKEN;
  if (!expected || expected.length < 32) {
    throw new ConnectionError("Set CONFIG_ADMIN_TOKEN to at least 32 characters on the server before configuring connections.", 503);
  }
  const actual = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ConnectionError("Invalid administrator token.", 401);
  checkRequestOrigin(request);
}

export function checkRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try { originHost = new URL(origin).host; } catch {
      throw new ConnectionError("Invalid request origin.", 403);
    }
    // Next.js can normalize request.url to localhost even when the browser uses an IP.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (originHost !== host) throw new ConnectionError("Cross-origin configuration requests are not allowed.", 403);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectionError("Settings must be a JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new ConnectionError(`${label} must be text of at most ${max} characters.`);
  }
  return value;
}

function secret(value: unknown, previous: string | undefined, label: string) {
  return value === undefined ? previous ?? "" : text(value, label, 16384);
}

export function parseApiEndpoint(value: unknown, previous = DEFAULT_CONNECTIONS.api): Pick<ApiSettings, "baseUrl" | "apiKey"> {
  const input = object(value);
  const baseUrl = text(input.baseUrl, "Base URL").trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new ConnectionError("Enter a valid API base URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ConnectionError("API base URL must use HTTP(S), without credentials, a query string or a fragment.");
  }
  const apiKey = secret(input.apiKey, previous.apiKey, "API key");
  if (/[\r\n]/.test(apiKey)) throw new ConnectionError("API key cannot contain line breaks.");
  if (apiKey && url.protocol !== "https:") {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host !== "localhost" && host !== "::1" && !/^127\./.test(host)) {
      throw new ConnectionError("Use HTTPS when sending an API key, except to a local loopback endpoint.");
    }
  }
  return { baseUrl, apiKey };
}

export function parseApi(value: unknown, previous = DEFAULT_CONNECTIONS.api): ApiSettings {
  const endpoint = parseApiEndpoint(value, previous);
  const input = object(value);
  const model = text(input.model, "Model", 256).trim();
  if (!model) throw new ConnectionError("A model ID is required.");
  if (input.reasoningEffort !== undefined && input.reasoningEffort !== "" && !isReasoningEffort(input.reasoningEffort)) {
    throw new ConnectionError("Choose a valid thinking effort or use the provider default.");
  }
  const outputTokens = parseOutputTokens(input.outputTokens);
  return {
    ...endpoint, model,
    ...(isReasoningEffort(input.reasoningEffort) ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(outputTokens ? { outputTokens } : {}),
  };
}

function parseOutputTokens(value: unknown): OutputTokenLimits | undefined {
  if (value === undefined || value === null) return undefined;
  const input = object(value);
  const unknown = Object.keys(input).filter((key) => !OUTPUT_TOKEN_STEPS.some((step) => step === key));
  if (unknown.length) throw new ConnectionError("Output-token limits accept only planning, chart and explanation.");
  const limits: OutputTokenLimits = {};
  for (const step of OUTPUT_TOKEN_STEPS) {
    const limit = input[step];
    if (limit === undefined || limit === null || limit === "") continue;
    if (!isOutputTokenLimit(limit)) {
      throw new ConnectionError(`The ${step} output-token limit must be a whole number from ${MIN_OUTPUT_TOKENS.toLocaleString("en-US")} to ${MAX_OUTPUT_TOKENS.toLocaleString("en-US")}.`);
    }
    limits[step] = limit;
  }
  return Object.keys(limits).length ? limits : undefined;
}

export function parseDatabase(value: unknown, previous = DEFAULT_CONNECTIONS.database): DatabaseSettings {
  const input = object(value);
  const host = text(input.host, "Host", 253).trim();
  if (!host || (!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))) {
    throw new ConnectionError("Enter a hostname or bare IPv4/IPv6 address, without a scheme or port.");
  }
  if (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new ConnectionError("Port must be an integer between 1 and 65535.");
  }
  const database = text(input.database, "Database", 256).trim();
  const username = text(input.username, "Username", 256).trim();
  if (!database || !username) throw new ConnectionError("Database and username are required.");
  if (typeof input.ssl !== "boolean") throw new ConnectionError("TLS must be enabled or disabled.");
  const caCertificate = text(input.caCertificate, "CA certificate", 32768).trim();
  if (caCertificate && (!input.ssl || !caCertificate.includes("-----BEGIN CERTIFICATE-----"))) {
    throw new ConnectionError("A CA certificate requires TLS and must be PEM encoded.");
  }
  return {
    host, port: input.port, database, username, ssl: input.ssl, caCertificate,
    password: secret(input.password, previous.password, "Password"),
  };
}

export function publicConnections(settings: Connections): PublicConnections {
  const { apiKey, ...api } = settings.api;
  const { password, ...database } = settings.database;
  return {
    api: { ...api, hasApiKey: Boolean(apiKey), ...(process.env.AI_GATEWAY_API_KEY?.trim() ? { environmentApiKeyAvailable: true } : {}) },
    database: { ...database, hasPassword: Boolean(password) },
  };
}

function effectiveApiSettings<T extends Pick<ApiSettings, "baseUrl" | "apiKey">>(settings: T): T {
  const environmentKey = process.env.AI_GATEWAY_API_KEY;
  if (!isVercelAiGateway(settings.baseUrl) || !environmentKey?.trim()) return settings;
  if (environmentKey.length > 16384 || /[\0\r\n]/.test(environmentKey)) {
    throw new ConnectionError("AI_GATEWAY_API_KEY in the server environment is invalid. Use a single-line Gateway API key.", 503);
  }
  return { ...settings, apiKey: environmentKey.trim() };
}

function apiKeyHint(settings: Pick<ApiSettings, "baseUrl">): string {
  return isVercelAiGateway(settings.baseUrl) && process.env.AI_GATEWAY_API_KEY?.trim()
    ? "AI_GATEWAY_API_KEY in the server environment (it overrides the configured key)"
    : "API key";
}

function apiResponseError(status: number, settings: Pick<ApiSettings, "baseUrl">): ConnectionError {
  const service = isVercelAiGateway(settings.baseUrl) ? "AI Gateway or its upstream model provider" : "The configured model service";
  if (status === 503) {
    return new ConnectionError(`API returned HTTP 503. ${service} is unavailable for this request. This status alone does not establish an invalid API key. Wait briefly and resend; if it persists, check provider status and model availability or ask the administrator to select another tool-capable model. No automatic retry or model switch was performed.`, 503);
  }
  if (status === 429) {
    return new ConnectionError("API returned HTTP 429. The provider rate limit or account quota was reached. Wait before resending, or ask the administrator to check provider usage, credits and limits. No automatic retry was performed.", 429);
  }
  if (status === 502 || status === 504) {
    return new ConnectionError(`API returned HTTP ${status}. ${service} could not complete the upstream request. Wait briefly and resend; if it persists, check provider status. No automatic retry was performed.`, status);
  }
  return new ConnectionError(`API returned HTTP ${status}. Check the saved URL, ${apiKeyHint(settings)}, model and provider access.`, 502);
}

function configPath() {
  return process.env.CONNECTION_CONFIG_PATH || path.join(process.cwd(), ".local", "connections.json");
}

async function loadConnectionDocument(): Promise<Record<string, unknown>> {
  let data: string;
  try { data = await readFile(/* turbopackIgnore: true */ configPath(), "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return object(JSON.parse(data));
}

export const CONFIGURATION_TABLE = {
  name: "public.insightful_configuration",
  create: `CREATE TABLE public.insightful_configuration (
    kind text PRIMARY KEY CHECK (kind = 'api'),
    settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
} as const;

export async function loadBootstrapConnections(): Promise<Partial<Connections>> {
  const saved = await loadConnectionDocument();
  return {
    ...(saved.api === undefined ? {} : { api: parseApi(saved.api) }),
    ...(saved.database === undefined ? {} : { database: parseDatabase(saved.database) }),
  };
}

function environmentApi(): ApiSettings | undefined {
  const keys = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLM_REASONING_EFFORT",
    "LLM_PLANNING_OUTPUT_TOKENS", "LLM_CHART_OUTPUT_TOKENS", "LLM_EXPLANATION_OUTPUT_TOKENS"];
  if (!keys.some((key) => process.env[key]?.trim())) return undefined;
  if (!process.env.LLM_BASE_URL?.trim() || !process.env.LLM_MODEL?.trim()) {
    throw new ConnectionError("Environment configuration requires both LLM_BASE_URL and LLM_MODEL.", 503);
  }
  return parseApi({
    baseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY ?? "",
    reasoningEffort: process.env.LLM_REASONING_EFFORT,
    outputTokens: Object.fromEntries(OUTPUT_TOKEN_STEPS.map((step) => {
      const value = process.env[`LLM_${step.toUpperCase()}_OUTPUT_TOKENS`];
      return [step, value?.trim() ? Number(value) : undefined];
    })),
  });
}

function environmentDatabase(): DatabaseSettings | undefined {
  const keys = ["DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USERNAME", "DB_PASSWORD", "DB_SSL", "DB_CA_CERTIFICATE"];
  if (!keys.some((key) => process.env[key]?.trim())) return undefined;
  if (!process.env.DB_HOST?.trim() || !process.env.DB_DATABASE?.trim() || !process.env.DB_USERNAME?.trim()) {
    throw new ConnectionError("Environment configuration requires DB_HOST, DB_DATABASE and DB_USERNAME.", 503);
  }
  const ssl = process.env.DB_SSL?.trim() || "true";
  if (ssl !== "true" && ssl !== "false") {
    throw new ConnectionError("DB_SSL must be true or false.", 503);
  }
  return parseDatabase({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT?.trim() ? Number(process.env.DB_PORT) : 5432,
    database: process.env.DB_DATABASE,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD ?? "",
    ssl: ssl === "true",
    caCertificate: process.env.DB_CA_CERTIFICATE ?? "",
  });
}

export async function loadConfiguredBootstrapConnections(): Promise<Partial<Connections>> {
  const api = environmentApi();
  const database = environmentDatabase();
  if (api && database) return { api, database };
  const saved = await loadConnectionDocument();
  return {
    ...(api ? { api } : saved.api === undefined ? {} : { api: parseApi(saved.api) }),
    ...(database ? { database } : saved.database === undefined ? {} : { database: parseDatabase(saved.database) }),
  };
}

async function writeConnectionDocument(document: Record<string, unknown>) {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(document, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function removeLegacyApi() {
  const saved = await loadConnectionDocument();
  if (saved.api !== undefined) {
    delete saved.api;
    await writeConnectionDocument(saved);
  }
}

async function withConfigurationDatabase<T>(settings: DatabaseSettings, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = createPostgresClient(settings, "insightful-configuration");
  let connectionError: Error | undefined;
  client.on("error", (error: Error) => { connectionError = error; });
  try {
    await client.connect();
    const result = await operation(client);
    if (connectionError) throw connectionError;
    return result;
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    console.error("PostgreSQL configuration storage failed", { code });
    throw new ConnectionError("Could not read or write PostgreSQL configuration. Check the saved database connection, TLS, settings table and SELECT/INSERT/UPDATE permissions. No file fallback was used.", 502);
  } finally {
    try { await client.end(); } catch { console.error("PostgreSQL configuration connection cleanup failed."); }
  }
}

async function readStoredApi(client: Client): Promise<{ initialized: boolean; api?: ApiSettings }> {
  const relation = await client.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [CONFIGURATION_TABLE.name]);
  if (!relation.rows[0]?.relation) return { initialized: false };
  const result = await client.query<{ settings: unknown }>("SELECT settings FROM public.insightful_configuration WHERE kind = 'api'");
  return {
    initialized: true,
    ...(result.rows.length ? { api: parseApi(result.rows[0].settings) } : {}),
  };
}

async function resolveSavedApi(saved: Partial<Connections>): Promise<ApiSettings | undefined> {
  const api = environmentApi();
  if (api) return api;
  if (!saved.database) return saved.api;
  const stored = await withConfigurationDatabase(saved.database, readStoredApi);
  return stored.initialized ? stored.api : saved.api;
}

export async function loadConnections(): Promise<Connections> {
  const saved = await loadConfiguredBootstrapConnections();
  return {
    api: await resolveSavedApi(saved) ?? structuredClone(DEFAULT_CONNECTIONS.api),
    database: saved.database ?? structuredClone(DEFAULT_CONNECTIONS.database),
  };
}

export async function loadSavedApi(): Promise<ApiSettings> {
  const api = environmentApi() ?? await resolveSavedApi(await loadConfiguredBootstrapConnections());
  if (!api) throw new ConnectionError("Save your API settings before starting a model chat.", 409);
  return api;
}

export async function loadSavedDatabase(): Promise<DatabaseSettings> {
  const database = environmentDatabase();
  if (database) return database;
  const saved = await loadConnectionDocument();
  if (saved.database === undefined) throw new ConnectionError("Save your database settings before using database operations.", 409);
  return parseDatabase(saved.database);
}

export function parseChatMessages(value: unknown): ModelChatMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CHAT_MESSAGES || value.length % 2 === 0) {
    throw new ConnectionError(`Send an alternating conversation ending with a user message, up to ${MAX_CHAT_MESSAGES} messages. Start a new chat if the limit is reached.`);
  }
  let total = 0;
  const messages = value.map((item: unknown, index) => {
    const message = object(item);
    const role: ModelChatMessage["role"] = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== role) throw new ConnectionError("Chat messages must alternate between user and assistant, beginning with a user.");
    const content = text(message.content, "Message", MAX_CHAT_MESSAGE_CHARS).trim();
    if (!content) throw new ConnectionError("Chat messages cannot be empty.");
    total += content.length;
    return { role, content };
  });
  if (total > MAX_CHAT_TOTAL_CHARS) throw new ConnectionError("Chat exceeds the 64,000 character context limit. Start a new chat.");
  return messages;
}

// Initialization and saves share a queue so migration cannot race a local save.
let saveQueue: Promise<unknown> = Promise.resolve();
export function updateConnectionStorage<T>(update: () => Promise<T>): Promise<T> {
  const operation = saveQueue.then(update);
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function saveConnection(kind: "api" | "database", value: unknown): Promise<PublicConnections> {
  return updateConnectionStorage(async () => {
    if (kind === "api" ? environmentApi() : environmentDatabase()) {
      throw new ConnectionError("This connection is managed by environment variables. Edit .env.local or your deployment environment and restart/redeploy; saved settings would not override it.", 409);
    }
    const saved = await loadBootstrapConnections();
    if (kind === "database") {
      const database = parseDatabase(value, saved.database ?? DEFAULT_CONNECTIONS.database);
      // Updating the bootstrap must work even when the old database is unreachable.
      await writeConnectionDocument({ ...saved, database });
      try { return publicConnections(await loadConnections()); } catch {
        throw new ConnectionError("The database connection was saved in the bootstrap file, but its API configuration could not be loaded. Check the new database connection, TLS and configuration permissions.", 502);
      }
    }
    const persistApi = async (client: Client) => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('insightful:configuration:api'))");
        const stored = await readStoredApi(client);
        if (!stored.initialized) {
          await client.query("ROLLBACK");
          return undefined;
        }
        const api = parseApi(value, stored.api ?? DEFAULT_CONNECTIONS.api);
        await client.query(`INSERT INTO public.insightful_configuration (kind, settings)
          VALUES ('api', $1::jsonb) ON CONFLICT (kind)
          DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`, [JSON.stringify(api)]);
        await client.query("COMMIT");
        return api;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {
          throw new ConnectionError("Configuration save failed and rollback could not be confirmed. Check PostgreSQL before retrying.", 502);
        }
        throw error;
      }
    };
    const database = environmentDatabase() ?? saved.database;
    const stored = database ? await withConfigurationDatabase(database, persistApi) : undefined;
    const api = stored ?? parseApi(value, saved.api ?? DEFAULT_CONNECTIONS.api);
    if (stored) {
      try { await removeLegacyApi(); } catch {
        throw new ConnectionError("API settings were saved in PostgreSQL, but the legacy file could not be cleaned up. Check its permissions and retry.", 500);
      }
    } else {
      await writeConnectionDocument({ ...saved, api });
    }
    return publicConnections({ api, database: database ?? DEFAULT_CONNECTIONS.database });
  });
}

const TIMEOUT_MS = 15000;
function redact(value: string, secrets: (string | undefined)[]) {
  return secrets.reduce<string>((message, key) => key ? message.split(key).join("[redacted]") : message, value);
}

async function readLimited(response: Response, maxBytes = 65536) {
  if (!response.body) throw new ConnectionError("API returned an empty response.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ConnectionError(`API response exceeded the ${maxBytes / 1024} KB limit.`, 502);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function listApiModels(settings: Pick<ApiSettings, "baseUrl" | "apiKey">): Promise<string[]> {
  return (await listApiModelCatalog(settings)).models;
}

export async function listApiModelCatalog(settings: Pick<ApiSettings, "baseUrl" | "apiKey">, signal?: AbortSignal): Promise<ModelCatalog> {
  settings = effectiveApiSettings(settings);
  try {
    const response = await fetch(`${settings.baseUrl}/models`, {
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConnectionError(`Model catalog returned HTTP ${response.status}. Check the base URL, ${apiKeyHint(settings)} and provider support for GET /models. You can still enter a model ID manually.`, 502);
    }
    let body: unknown;
    try { body = JSON.parse(await readLimited(response, 2 * 1024 * 1024)); } catch (error) {
      if (error instanceof SyntaxError) throw new ConnectionError("Model catalog returned invalid JSON.", 502);
      throw error;
    }
    if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
      throw new ConnectionError("Model catalog must return an OpenAI-compatible data array.", 502);
    }
    const entries = body.data.map((model: unknown): [string, ReasoningEffort[]] => {
      if (!model || typeof model !== "object" || !("id" in model) ||
        typeof model.id !== "string" || !model.id.trim() || model.id.length > 256 ||
        /[\0\r\n]/.test(model.id)) {
        throw new ConnectionError("Model catalog contains an invalid model ID.", 502);
      }
      if (settings.apiKey && model.id.includes(settings.apiKey)) {
        throw new ConnectionError("Model catalog unexpectedly reflected a credential. Model IDs were not returned.", 502);
      }
      const efforts = "reasoning_options" in model && Array.isArray(model.reasoning_options)
        ? model.reasoning_options.flatMap((option: unknown) => {
          if (!option || typeof option !== "object" || !("type" in option) || option.type !== "effort" ||
            !("values" in option) || !Array.isArray(option.values)) return [];
          return option.values.filter(isReasoningEffort);
        })
        : [];
      return [model.id, [...new Set(efforts)]];
    });
    if (!entries.length) throw new ConnectionError("The provider returned an empty model catalog. You can enter a model ID manually.", 502);
    return {
      models: [...new Set(entries.map(([id]) => id))].sort((a, b) => a.localeCompare(b)),
      reasoningEfforts: Object.fromEntries(entries),
    };
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    if (signal?.aborted) throw new ConnectionError("Model catalog request was cancelled or timed out.", 499);
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new ConnectionError("Model catalog request timed out after 15 seconds.", 504);
    }
    throw new ConnectionError("Could not load the model catalog. Check the URL, TLS and network access. You can enter a model ID manually.", 502);
  }
}

async function checkReasoningEffort(settings: ApiSettings, signal?: AbortSignal, preferLow = false): Promise<ApiSettings> {
  if (!settings.reasoningEffort && !preferLow) return settings;
  const catalog = await listApiModelCatalog(settings, signal);
  const supported = modelReasoningEfforts(catalog, settings.model);
  if (preferLow && supported.includes("low") && !["none", "minimal"].includes(settings.reasoningEffort ?? "")) {
    return { ...settings, reasoningEffort: "low" };
  }
  if (settings.reasoningEffort && !supported.includes(settings.reasoningEffort)) {
    throw new ConnectionError("The provider catalog does not advertise the selected thinking effort for this model. Refresh models and select a supported effort, or choose Provider default.");
  }
  return settings;
}

const connectionProbeSchema = z.object({
  ok: z.literal(true),
  feedback: z.string().min(1).max(2000),
}).strict();

async function completeApi(
  settings: ApiSettings, messages: ModelChatMessage[], maxTokens: number, timeoutMs: number, signal?: AbortSignal,
): Promise<{ feedback: string; durationMs: number }> {
  settings = effectiveApiSettings(settings);
  const start = Date.now();
  await checkReasoningEffort(settings, signal);
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({
        model: settings.model,
        messages,
        max_tokens: maxTokens, stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "researchConnectionProbe",
            strict: true,
            schema: z.toJSONSchema(connectionProbeSchema),
          },
        },
        ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      redirect: "error", cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw apiResponseError(response.status, settings);
    }
    let body: unknown;
    try { body = JSON.parse(await readLimited(response)); } catch (error) {
      if (error instanceof SyntaxError) throw new ConnectionError("API returned invalid JSON, not an OpenAI-compatible reply.", 502);
      throw error;
    }
    const completion = z.object({
      choices: z.array(z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
      })).min(1),
    }).safeParse(body);
    if (!completion.success) {
      throw new ConnectionError("API returned an incomplete OpenAI-compatible completion. The structured-output test did not pass.", 502);
    }
    const choice = completion.data.choices[0];
    if (choice.finish_reason === "length") {
      throw new ConnectionError(`The connection test reached its ${maxTokens.toLocaleString("en-US")}-token output limit. Lower thinking effort or raise the planning output-token limit, then test again.`, 502);
    }
    if (choice.finish_reason !== "stop" || choice.message.refusal) {
      throw new ConnectionError("API did not finish the structured-output connection test normally. The test did not pass.", 502);
    }
    const reply = choice.message.content;
    if (typeof reply !== "string" || !reply.trim()) {
      throw new ConnectionError("API responded, but returned no non-empty assistant feedback. The test did not pass.", 502);
    }
    let value: unknown;
    try { value = JSON.parse(reply); } catch {
      throw new ConnectionError("API returned assistant text instead of valid JSON-schema structured output. Choose a model and endpoint that support strict JSON-schema output for research.", 502);
    }
    const probe = connectionProbeSchema.safeParse(value);
    if (!probe.success || !probe.data.feedback.trim()) {
      throw new ConnectionError("API assistant output did not match the requested strict JSON schema. The research compatibility test did not pass.", 502);
    }
    return { feedback: redact(probe.data.feedback.trim(), [settings.apiKey]), durationMs: Date.now() - start };
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    if (signal?.aborted) throw new ConnectionError("Model request was cancelled.", 499);
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ConnectionError(`API request timed out after ${timeoutMs / 1000} seconds.`, 504);
    throw new ConnectionError("Could not reach the API. Check DNS, the URL, TLS certificate and network access. Redirects are not followed.", 502);
  }
}

export async function testApi(settings: ApiSettings): Promise<ConnectionTestResult> {
  const result = await completeApi(settings, [
    { role: "user", content: 'Return one JSON object matching the requested schema: {"ok":true,"feedback":"Connection confirmed."}. Use a short confirmation for feedback, no Markdown or extra fields.' },
  ], outputTokenLimit(settings, "planning"), TIMEOUT_MS);
  return { ok: true, message: "Model feedback and strict JSON-schema output verified. Research plans are still validated on every request.", ...result };
}

export type SavedModelRunOptions = {
  model: LanguageModel;
  settings: ApiSettings;
  messages: ModelChatMessage[];
  abortSignal: AbortSignal;
  onError: (error: unknown) => void;
  onToolActivity: (activity: ModelChatToolActivity) => void;
};
export type SavedModelRunner = (options: SavedModelRunOptions) => AsyncIterable<TextStreamPart<ToolSet>>;

export async function streamChatWithSavedModel(
  messages: ModelChatMessage[], signal?: AbortSignal, runner?: SavedModelRunner,
): Promise<Response> {
  const savedSettings = effectiveApiSettings(await loadSavedApi());
  const started = Date.now();
  const timeoutMs = runner ? HKEX_SERVER_TIMEOUT_MS : 60000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const upstream = new AbortController();
  const abortSignal = AbortSignal.any([...(signal ? [signal] : []), timeout, upstream.signal]);
  const settings = await checkReasoningEffort(savedSettings, abortSignal, Boolean(runner));
  let transportError: ConnectionError | undefined;
  let retryUsed = false;
  // Larger token limits need room for SSE framing (roughly 100-400 bytes per streamed token).
  const streamBytes = runner
    ? Math.max(1024 * 1024, Math.max(...OUTPUT_TOKEN_STEPS.map((step) => outputTokenLimit(settings, step))) * 512)
    : 1024 * 1024;
  const provider = createOpenAICompatible({
    name: "saved-model",
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    supportsStructuredOutputs: Boolean(runner),
    fetch: async (input, init) => {
      let response = await fetch(input, { ...init, redirect: "error", cache: "no-store" });
      if (runner && response.status === 503 && !retryUsed && !abortSignal.aborted) {
        retryUsed = true;
        await response.body?.cancel();
        console.warn("HKEX model request returned HTTP 503; using the turn's single delayed retry.");
        await delay(1000, undefined, { signal: abortSignal });
        response = await fetch(input, { ...init, redirect: "error", cache: "no-store" });
      }
      if (!response.ok) {
        await response.body?.cancel();
        transportError = apiResponseError(response.status, settings);
        if (retryUsed) {
          transportError = new ConnectionError(
            transportError.message.replace(/No automatic retry[^.]*\./, "This research turn already used its single automatic 503 retry; no further retry or model switch was performed."),
            transportError.status,
          );
        }
        throw transportError;
      }
      if (!response.body) throw new ConnectionError("API returned an empty response.", 502);
      let size = 0;
      return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > streamBytes) {
            transportError = new ConnectionError(`API stream exceeded the ${Math.round(streamBytes / 1024)} KB limit.`, 502);
            throw transportError;
          }
          controller.enqueue(chunk);
        },
      })), { status: response.status, headers: response.headers });
    },
  });
  function streamError(error: unknown) {
    if (transportError) return transportError.message;
    if (signal?.aborted) return "Model request was cancelled.";
    if (timeout.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
      return `API request timed out after ${timeoutMs / 1000} seconds.`;
    }
    if (error instanceof ConnectionError) return error.message;
    if (APICallError.isInstance(error)) {
      return "AI SDK could not read a valid OpenAI-compatible model response. Check the saved endpoint and model.";
    }
    return "AI SDK model stream ended or failed before completion. Check the saved endpoint, TLS, network access and provider compatibility, then retry.";
  }
  const stream = createUIMessageStream<UIMessage<ModelChatMetadata, { tool: ModelChatToolActivity }>>({
    onError: streamError,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: randomUUID() });
      let finished = false;
      const output = (kind: "text" | "reasoning", id: string) => {
        let buffered = "";
        let text = "";
        let started = false;
        let clipped = false;
        const flush = (final = false) => {
          buffered = redact(buffered, [settings.apiKey]);
          let keep = 0;
          // Retain a possible credential prefix so split stream chunks cannot leak it.
          if (!final && settings.apiKey) {
            for (let length = Math.min(buffered.length, settings.apiKey.length - 1); length > 0; length--) {
              if (buffered.endsWith(settings.apiKey.slice(0, length))) { keep = length; break; }
            }
          }
          let delta = buffered.slice(0, buffered.length - keep);
          buffered = buffered.slice(buffered.length - keep);
          if (clipped) return;
          // Research thinking is display-only, so long thinking is clipped rather than failing the turn.
          if (runner && kind === "reasoning" && text.length + delta.length > MAX_CHAT_MESSAGE_CHARS) {
            delta = delta.slice(0, MAX_CHAT_MESSAGE_CHARS - text.length) + "\n\n[Thinking shortened for display.]";
            clipped = true;
          }
          text += delta;
          if (!clipped && text.length > MAX_CHAT_MESSAGE_CHARS) throw new ConnectionError(`Model ${kind === "text" ? "reply" : "thinking"} exceeded the 16,000 character chat limit. Try a shorter response.`, 502);
          if (!delta) return;
          if (!started) { writer.write({ type: kind === "text" ? "text-start" : "reasoning-start", id }); started = true; }
          writer.write({ type: kind === "text" ? "text-delta" : "reasoning-delta", id, delta });
        };
        return {
          push(delta: string) { buffered += delta; flush(); },
          end() {
            flush(true);
            if (started) writer.write({ type: kind === "text" ? "text-end" : "reasoning-end", id });
          },
          get text() { return text; },
        };
      };
      const reply = output("text", "reply");
      const reasoning = output("reasoning", "thinking");
      try {
        const onError = (error: unknown) => { console.error("Saved-model stream:", streamError(error)); };
        const model = provider.chatModel(settings.model);
        const modelStream = runner ? runner({
          model, settings, messages, abortSignal, onError,
          onToolActivity: (activity) => writer.write({ type: "data-tool", id: activity.id, data: activity }),
        }) : streamText({
          model, messages, maxOutputTokens: 1024, maxRetries: 0, abortSignal,
          ...(settings.reasoningEffort ? { providerOptions: { savedModel: { reasoningEffort: settings.reasoningEffort } } } : {}),
          onError: ({ error }) => onError(error),
        }).stream;
        for await (const part of modelStream) {
          if (part.type === "error") throw part.error;
          if (part.type === "abort") throw new ConnectionError(timeout.aborted ? `API request timed out after ${timeoutMs / 1000} seconds.` : "Model request was cancelled.", 499);
          if (runner && part.type === "finish" && part.finishReason === "length") {
            throw new ConnectionError("Research generation reached its output-token limit, which may include thinking tokens. Try a narrower question, or raise the output-token limits in Configuration. No automatic retry was performed.", 502);
          }
          if (part.type === "text-delta") reply.push(part.text);
          if (part.type === "reasoning-delta") reasoning.push(part.text);
          if (part.type === "finish") finished = !["other", "error", "interrupted"].includes(part.finishReason);
        }
        if (abortSignal.aborted || !finished) throw new ConnectionError("Model stream ended before the reply completed. Your message can be retried.", 502);
        reasoning.end();
        reply.end();
        if (!reply.text.trim()) throw new ConnectionError("API responded, but returned no non-empty assistant feedback.", 502);
        writer.write({
          type: "finish",
          messageMetadata: { model: settings.model, baseUrl: runner ? "" : settings.baseUrl, durationMs: Date.now() - started, completed: true },
        });
      } finally { upstream.abort(); }
    },
  });
  const reader = stream.getReader();
  const cancellable = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      upstream.abort();
      await reader.cancel(reason);
    },
  });
  return createUIMessageStreamResponse({ stream: cancellable, headers: { "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
export function createPostgresClient(settings: DatabaseSettings, applicationName: string, queryTimeoutMs = TIMEOUT_MS) {
  return new Client({
    host: settings.host, port: settings.port, database: settings.database, user: settings.username, password: settings.password,
    ssl: settings.ssl ? { rejectUnauthorized: true, ...(settings.caCertificate ? { ca: settings.caCertificate } : {}) } : false,
    connectionTimeoutMillis: TIMEOUT_MS, query_timeout: queryTimeoutMs, statement_timeout: queryTimeoutMs,
    application_name: applicationName,
  });
}

export async function testDatabase(settings: DatabaseSettings): Promise<ConnectionTestResult> {
  const start = Date.now();
  const client = createPostgresClient(settings, "insightful-connection-test");
  let connectionError: Error | undefined;
  client.on("error", (error: Error) => { connectionError = error; });
  try {
    await client.connect();
    const result = await client.query<{ database: string; user: string; feedback: number }>(
      "SELECT current_database() AS database, current_user AS \"user\", 1::int AS feedback",
    );
    if (connectionError) throw connectionError;
    const row = result.rows[0];
    if (!row || row.feedback !== 1) throw new ConnectionError("Database returned no expected query feedback.", 502);
    return {
      ok: true, message: "PostgreSQL query feedback received.",
      feedback: redact(`Connected to ${row.database} as ${row.user}. SELECT returned ${row.feedback}.`, [settings.password]),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    const code = (error as { code?: string }).code;
    const hints: Record<string, string> = {
      "28P01": "Authentication failed. Check the username and password.",
      "28000": "Authentication rejected. Check credentials and server access rules.",
      "3D000": "Database does not exist. Check the database name.",
      ECONNREFUSED: "Connection refused. Check the host/IP, port and database listener.",
      ENOTFOUND: "Database hostname could not be resolved.",
      ETIMEDOUT: "Database connection timed out. Check firewall and network access.",
      CERT_HAS_EXPIRED: "Database TLS certificate has expired.",
      DEPTH_ZERO_SELF_SIGNED_CERT: "Database TLS certificate is not trusted. Supply the correct CA certificate.",
      SELF_SIGNED_CERT_IN_CHAIN: "Database TLS certificate chain is not trusted. Supply the correct CA certificate.",
      ERR_TLS_CERT_ALTNAME_INVALID: "Database hostname does not match the TLS certificate. Use the provider hostname.",
    };
    throw new ConnectionError(hints[code ?? ""] ?? "PostgreSQL test failed. Check credentials, TLS settings, database permissions and network access.", 502);
  } finally { await client.end(); }
}

export function configurationError(error: unknown) {
  if (error instanceof ConnectionError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error("Connection configuration operation failed", JSON.stringify({
    name: error instanceof Error ? error.name : "UnknownError",
    code: error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined,
  }));
  return Response.json({ error: "Could not read or write connection settings. Check the server bootstrap file, its permissions and PostgreSQL configuration storage." }, { status: 500 });
}

export async function readConfigurationBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new ConnectionError("Request body must be valid JSON."); }
  return object(body);
}
