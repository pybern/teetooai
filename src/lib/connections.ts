import type { HkexChartSpec } from "./hkex-chart";
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
export type ApiSettings = { baseUrl: string; model: string; apiKey?: string; reasoningEffort?: ReasoningEffort };
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
export type ModelChatToolActivity = { id: string; tool: string; status: "running" | "complete" | "error"; summary: string; sql?: string; parameters?: (string | string[] | number | null)[]; chart?: HkexChartSpec; insights?: InsightSummary; explanationId?: string };
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
export const HKEX_MAX_OUTPUT_TOKENS = 4096;
export const HKEX_SERVER_TIMEOUT_MS = 120000;
export const HKEX_CLIENT_TIMEOUT_MS = 150000;

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
