import { DefaultChatTransport, readUIMessageStream, type UIMessage } from "ai";
import type { ModelChatMessage, ModelChatMetadata, ModelChatResult, ModelChatToolActivity } from "./connections";
import { HKEX_CLIENT_TIMEOUT_MS } from "./connections";

type ChatUIMessage = UIMessage<ModelChatMetadata, { tool: ModelChatToolActivity }>;

export function researchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/expired|unavailable on this server/i.test(message)) return "These results are no longer available. Ask your question again to get a new explanation.";
  if (/timed out|timeout/i.test(message) || (error instanceof Error && error.name === "TimeoutError")) return "This is taking longer than expected. Try again or ask a more focused question.";
  if (/cancel|abort/i.test(message)) return "Research was cancelled. You can send your question again.";
  if (/429|rate limit|quota|too many|already active|busy/i.test(message)) return "Research is busy right now. Please wait a moment and try again.";
  if (/output(?:-token)? limit|character|chat limit|conversation limit/i.test(message)) return "We couldn't finish this request. Try a shorter question or start a new chat.";
  return "We couldn't complete your request. Please try again. If the problem continues, contact support.";
}

export async function sendModelChat(
  token: string | undefined, messages: ModelChatMessage[], signal: AbortSignal, onText: (text: string) => void,
  onReasoning?: (reasoning: string) => void,
  options?: { api: "/api/hkex/chat"; onTools?: (tools: ModelChatToolActivity[]) => void; explanationId?: string; useCaseId?: string },
): Promise<ModelChatResult> {
  const transport = new DefaultChatTransport<ChatUIMessage>({
    api: options?.api ?? "/api/config/chat",
    headers: !options && token ? { Authorization: `Bearer ${token}` } : {},
    prepareSendMessagesRequest: () => ({
      body: options?.explanationId ? { explanationId: options.explanationId } : { messages, ...(options?.useCaseId ? { useCaseId: options.useCaseId } : {}) },
    }),
    fetch: async (url, init) => {
      const response = await fetch(url, { ...init, cache: "no-store" });
      if (!response.ok) {
        let body: { error?: unknown };
        try { body = await response.json(); } catch { throw new Error(`Chat request failed (HTTP ${response.status}).`); }
        throw new Error(typeof body.error === "string" ? body.error : `Chat request failed (HTTP ${response.status}).`);
      }
      if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
        throw new Error("Chat endpoint did not return a model stream. Refresh the page and try again.");
      }
      return response;
    },
  });
  const stream = await transport.sendMessages({
    trigger: "submit-message", chatId: "config-model-test", messageId: undefined,
    messages: [], abortSignal: AbortSignal.any([signal, AbortSignal.timeout(options ? HKEX_CLIENT_TIMEOUT_MS : 70000)]),
  });
  let text = "";
  let reasoning = "";
  let metadata: ModelChatMetadata | undefined;
  let tools: ModelChatToolActivity[] = [];
  for await (const message of readUIMessageStream<ChatUIMessage>({ stream, terminateOnError: true })) {
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
    reasoning = message.parts.filter((part) => part.type === "reasoning").map((part) => part.text).join("");
    metadata = message.metadata;
    tools = message.parts.filter((part) => part.type === "data-tool").map((part) => part.data);
    onText(text);
    onReasoning?.(reasoning);
    options?.onTools?.(tools);
  }
  if (!metadata?.completed || !text.trim()) throw new Error("Model stream ended without a completed assistant reply. Your message can be retried.");
  return {
    message: { role: "assistant", content: text.trim() },
    ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
    ...(tools.length ? { tools } : {}),
    model: metadata.model, baseUrl: metadata.baseUrl, durationMs: metadata.durationMs,
  };
}
