import type { HkexChartSpec } from "./hkex-chart";
import type { SqlChartSpec } from "./sql-chart";
import type { InsightSummary } from "./types";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export type ModelCatalog = { models: string[]; reasoningEfforts: Record<string, ReasoningEffort[]> };
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.some((effort) => effort === value);
}
export function modelReasoningEfforts(catalog: ModelCatalog, model: string): ReasoningEffort[] {
  return Object.hasOwn(catalog.reasoningEfforts, model) ? catalog.reasoningEfforts[model] : [];
}
/** Model calls in a research turn, each with its own output-token limit (thinking tokens count towards it). */
export const OUTPUT_TOKEN_STEPS = ["planning", "chart", "explanation"] as const;
export type OutputTokenStep = typeof OUTPUT_TOKEN_STEPS[number];
export type OutputTokenLimits = Partial<Record<OutputTokenStep, number>>;
export const DEFAULT_OUTPUT_TOKENS: Record<OutputTokenStep, number> = { planning: 4096, chart: 4096, explanation: 4096 };
export const MIN_OUTPUT_TOKENS = 256;
export const MAX_OUTPUT_TOKENS = 32768;
export function isOutputTokenLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_OUTPUT_TOKENS && value <= MAX_OUTPUT_TOKENS;
}
export function outputTokenLimit(settings: { outputTokens?: OutputTokenLimits }, step: OutputTokenStep): number {
  const value = settings.outputTokens?.[step];
  return isOutputTokenLimit(value) ? value : DEFAULT_OUTPUT_TOKENS[step];
}
export type ApiSettings = { baseUrl: string; model: string; apiKey?: string; reasoningEffort?: ReasoningEffort; outputTokens?: OutputTokenLimits };
export type DatabaseSettings = {
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  caCertificate: string;
  password?: string;
};
export type Connections = { api: ApiSettings; database: DatabaseSettings };
export type PublicConnections = {
  api: Omit<ApiSettings, "apiKey"> & { hasApiKey: boolean; environmentApiKeyAvailable?: boolean };
  database: Omit<DatabaseSettings, "password"> & { hasPassword: boolean };
};
export type ConnectionTestResult = { ok: true; message: string; feedback: string; durationMs: number };
export type ModelChatMessage = { role: "user" | "assistant"; content: string };
export type ModelChatToolActivity = { id: string; tool: string; status: "running" | "complete" | "error"; summary: string; sql?: string; parameters?: (string | string[] | number | null)[]; chart?: HkexChartSpec; sqlChart?: SqlChartSpec; insights?: InsightSummary; explanationId?: string };
export type ModelChatResult = { message: ModelChatMessage; reasoning?: string; tools?: ModelChatToolActivity[]; model: string; baseUrl: string; durationMs: number };
export type ModelChatMetadata = { model: string; baseUrl: string; durationMs: number; completed: boolean };
export type DatabaseInitializationResult = {
  ok: true;
  database: string;
  host: string;
  port: number;
  tables: { name: string; status: "created" | "seeded" | "skipped"; insertedRows: number }[];
  durationMs: number;
  hkexCoverage?: { records: number; from: string; to: string; currencies: string[] };
};
export const MAX_CHAT_MESSAGES = 21;
export const MAX_CHAT_MESSAGE_CHARS = 16000;
export const MAX_CHAT_TOTAL_CHARS = 64000;
// Token limits are the primary control; this is a safety net that fits a 300-second hosting limit.
export const HKEX_SERVER_TIMEOUT_MS = 290000;
// The browser waits longer than the server deadline so server timeouts are reported, not cut off.
export const HKEX_CLIENT_TIMEOUT_MS = 320000;

export function isVercelAiGateway(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.origin === "https://ai-gateway.vercel.sh" && /^\/v1\/?$/.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export const DEFAULT_CONNECTIONS: Connections = {
  api: { baseUrl: "https://ai-gateway.vercel.sh/v1", model: "openai/gpt-4.1-mini", apiKey: "" },
  database: { host: "", port: 5432, database: "", username: "", password: "", ssl: true, caCertificate: "" },
};
