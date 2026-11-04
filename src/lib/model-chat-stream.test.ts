import { afterEach, describe, expect, it, vi } from "vitest";
import { HKEX_CLIENT_TIMEOUT_MS } from "./connections";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { researchErrorMessage, sendModelChat } from "./model-chat-stream";

const messages = [{ role: "user" as const, content: "Hello" }];
const metadata = { model: "test/model", baseUrl: "https://saved.example/v1", durationMs: 25, completed: true };

function response({ complete = true, error = "", reasoning = "" } = {}) {
  return createUIMessageStreamResponse({ stream: createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      if (reasoning) {
        writer.write({ type: "reasoning-start", id: "thinking" });
        writer.write({ type: "reasoning-delta", id: "thinking", delta: reasoning });
        writer.write({ type: "reasoning-end", id: "thinking" });
      }
      writer.write({ type: "text-start", id: "reply" });
      writer.write({ type: "text-delta", id: "reply", delta: "Hello 你好" });
      if (error) { writer.write({ type: "error", errorText: error }); return; }
      if (complete) {
        writer.write({ type: "text-end", id: "reply" });
        writer.write({ type: "finish", messageMetadata: metadata });
      }
    },
  }) });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("SDK chat stream client", () => {
  it.each([
    ["API returned HTTP 429. Provider quota reached.", "Please wait a moment"],
    ["API request timed out after 240 seconds.", "taking longer than expected"],
    ["The operation was aborted due to timeout", "taking longer than expected"],
    ["Research planning reached its 4,096-token output limit", "Try a shorter question"],
    ["Research generation reached its output-token limit, which may include thinking tokens.", "Try a shorter question"],
    ["Research was cancelled.", "Research was cancelled"],
    ["These research results expired or are unavailable on this server.", "no longer available"],
    ["Saved PostgreSQL database needs SELECT permissions.", "Please try again"],
  ])("explains research failures in plain language: %s", (message, expected) => {
    const friendly = researchErrorMessage(new Error(message));
    expect(friendly).toContain(expected);
    expect(friendly).not.toMatch(/HTTP|PostgreSQL|SELECT|tokens|provider|quota|240 seconds/i);
  });
  it("parses fragmented SSE and UTF-8 and sends only messages plus administrator authentication", async () => {
    const bytes = new Uint8Array(await response().arrayBuffer());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();
    const result = await sendModelChat("test-admin", messages, new AbortController().signal, onText);
    expect(result).toEqual({
      message: { role: "assistant", content: "Hello 你好" },
      model: metadata.model, baseUrl: metadata.baseUrl, durationMs: metadata.durationMs,
    });
    expect(onText).toHaveBeenCalledWith("Hello 你好");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/config/chat");
    expect(JSON.parse(init!.body as string)).toEqual({ messages });
    expect(new Headers(init!.headers).get("Authorization")).toBe("Bearer test-admin");
  });
  it("reports preflight JSON errors without exposing protocol payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Save your API settings first." }, { status: 409 })));
    await expect(sendModelChat("admin", messages, new AbortController().signal, vi.fn())).rejects.toThrow("Save your API settings first.");
  });
  it("never forwards an administrator token to the public research route", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn<typeof fetch>(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    await sendModelChat("test-admin", messages, new AbortController().signal, vi.fn(), undefined, { api: "/api/hkex/chat" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/hkex/chat");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(timeout).toHaveBeenCalledWith(HKEX_CLIENT_TIMEOUT_MS);
  });
  it("streams reasoning separately from the answer and returns it for display", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ reasoning: "Provider reasoning 你好" })));
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const result = await sendModelChat("admin", messages, new AbortController().signal, onText, onReasoning);
    expect(onReasoning).toHaveBeenCalledWith("Provider reasoning 你好");
    expect(onText).toHaveBeenCalledWith("Hello 你好");
    expect(onText).not.toHaveBeenCalledWith("Provider reasoning 你好");
    expect(result.reasoning).toBe("Provider reasoning 你好");
    expect(result.message.content).toBe("Hello 你好");
  });
  it("rejects an old non-streaming endpoint response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Old reply" })));
    await expect(sendModelChat("admin", messages, new AbortController().signal, vi.fn())).rejects.toThrow("did not return a model stream");
  });
  it.each([
    { complete: false, error: "", expected: "without a completed assistant reply" },
    { complete: false, error: "Provider stream disconnected.", expected: "Provider stream disconnected." },
  ])("does not treat incomplete/error streams as successful ($expected)", async ({ complete, error, expected }) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ complete, error })));
    const onText = vi.fn();
    await expect(sendModelChat("admin", messages, new AbortController().signal, onText)).rejects.toThrow(expected);
    expect(onText).toHaveBeenCalledWith("Hello 你好");
  });
});
