// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { DEFAULT_CONNECTIONS, type ModelChatToolActivity } from "@/lib/connections";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { HkexAgentWorkspace } from "./hkex-agent-workspace";

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const settings = {
  api: { ...DEFAULT_CONNECTIONS.api, hasApiKey: true },
  database: { ...DEFAULT_CONNECTIONS.database, host: "db.example", database: "research", hasPassword: true },
};
async function edit(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset().mockRejectedValue(new Error("Unexpected network request"));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(HkexAgentWorkspace, { uc: USE_CASE_BY_ID["hkex-db"] }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("HKEX database agent workspace", () => {
  it("fills the available height with a keyboard-scrollable conversation and a non-shrinking composer", () => {
    const workspace = container.querySelector("[data-research-workspace]")!;
    expect(workspace.classList.contains("min-h-0")).toBe(true);
    expect(workspace.classList.contains("flex-1")).toBe(true);
    const chat = container.querySelector("section")!;
    expect(chat.classList.contains("flex-1")).toBe(true);
    expect(chat.classList.contains("min-h-0")).toBe(true);
    expect(chat.classList.contains("h-[52rem]")).toBe(false);
    const log = container.querySelector<HTMLElement>('[role="log"]')!;
    expect(log.classList.contains("overflow-y-auto")).toBe(true);
    expect(log.classList.contains("min-h-0")).toBe(true);
    expect(log.tabIndex).toBe(0);
    expect(container.querySelector("form")!.classList.contains("shrink-0")).toBe(true);
  });
  it("opens directly without a token or configuration request and does not automatically query or charge", async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("HKEX Short-Selling Research");
    expect(container.textContent).not.toMatch(/PostgreSQL|tokens|tool calls|model call|Skills:|administrator|thinking effort|provider/i);
    expect(container.querySelector('a[href="/config"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).not.toContain("db.example");
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === USE_CASE_BY_ID["hkex-db"].questions[0].q)!.click();
    });
    expect(container.querySelector("textarea")!.value).toBe(USE_CASE_BY_ID["hkex-db"].questions[0].q);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows thinking, tool calls and SQL with the answer, without instructional copy", async () => {
    const item: ModelChatToolActivity = { id: "read-1", tool: "queryHkex", status: "complete", summary: "1 evidence rows.", sql: "SELECT stock_code FROM allowed_table WHERE currency = $1", parameters: ["HKD"] };
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/hkex/chat");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: "user", content: "Rank HKD" }], useCaseId: "hkex-db" });
      return createUIMessageStreamResponse({ stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "start" });
          writer.write({ type: "data-tool", id: item.id, data: { ...item, status: "running" } });
          writer.write({ type: "data-tool", id: item.id, data: item });
          writer.write({ type: "reasoning-start", id: "private-reasoning" });
          writer.write({ type: "reasoning-delta", id: "private-reasoning", delta: "Internal model reasoning: execute queryHkex with SQL parameters." });
          writer.write({ type: "reasoning-end", id: "private-reasoning" });
          writer.write({ type: "text-start", id: "answer" });
          writer.write({ type: "text-delta", id: "answer", delta: "**Database-backed answer**" });
          writer.write({ type: "text-end", id: "answer" });
          writer.write({ type: "finish", messageMetadata: { model: settings.api.model, baseUrl: "", durationMs: 25, completed: true } });
        },
      }) });
    });
    await edit("textarea", "Rank HKD");
    await submit();
    expect([...container.querySelectorAll("article:last-child strong")].at(-1)?.textContent).toBe("Database-backed answer");
    expect(container.textContent).toContain("Research tools");
    expect(container.textContent).toContain("queryHkex");
    expect(container.textContent).toContain(item.sql);
    expect(container.textContent).toContain("Parameters:");
    expect(container.textContent).not.toContain("Last reply:");
    expect(container.textContent).not.toContain("Internal model reasoning");
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand thinking"]')!.click(); });
    expect(container.textContent).toContain("Internal model reasoning");
    expect(container.textContent).not.toMatch(/Skills:|thinking effort|output tokens|One model call plans|shared request limits/);
    expect(container.textContent).not.toContain(settings.api.model);
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "New chat")!.click(); });
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.textContent).not.toContain("Database-backed answer");
  });
  it("reports missing server setup without asking the visitor for administrator credentials", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Save your database settings before using database operations." }, { status: 409 }));
    await edit("textarea", "Rank HKD");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please try again");
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("Save your database settings");
    expect(container.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(container.querySelector("details pre")?.textContent).toBe("Save your database settings before using database operations.");
    expect(container.querySelector("textarea")!.value).toBe("Rank HKD");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hkex/chat");
  });
});

describe("shared research error details", () => {
  it.each([
    { useCaseId: "hk", streamed: false },
    { useCaseId: "hk", streamed: true },
    { useCaseId: "hkex-db", streamed: false },
    { useCaseId: "hkex-db", streamed: true },
  ])("offers collapsed actual errors for $useCaseId (streamed: $streamed)", async ({ useCaseId, streamed }) => {
    await act(async () => root.render(createElement(HkexAgentWorkspace, { uc: USE_CASE_BY_ID[useCaseId] })));
    const message = streamed ? "The model did not return a valid structured research plan." : "The saved database user needs SELECT access to the HKEX table.";
    fetchMock.mockResolvedValueOnce(streamed
      ? createUIMessageStreamResponse({ stream: createUIMessageStream({
        execute: ({ writer }) => { writer.write({ type: "error", errorText: message }); },
      }) })
      : Response.json({ error: message }, { status: 502 }));
    await edit("textarea", "Research question"); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please try again");
    const details = container.querySelector<HTMLDetailsElement>("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Error details");
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector("pre")?.textContent).toBe(message);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")!.value).toBe("Research question");
  });
});

describe("HK Equities agent workspace", () => {
  beforeEach(async () => {
    await act(async () => root.render(createElement(HkexAgentWorkspace, { uc: USE_CASE_BY_ID.hk }, createElement("p", null, "Market strip"))));
  });
  it("uses the HK brief, examples and market strip, and sends its use case to the agent", async () => {
    expect(container.textContent).toContain("HK Equities Analyst");
    expect(container.textContent).toContain("Market strip");
    expect(container.textContent).not.toContain("HKEX short selling");
    expect(container.textContent).not.toContain("Chart the top 10 HKD stocks");
    const example = USE_CASE_BY_ID.hk.questions[0].q;
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === example)!.click(); });
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/hkex/chat");
      expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: "user", content: example }], useCaseId: "hk" });
      return createUIMessageStreamResponse({ stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id: "answer" });
          writer.write({ type: "text-delta", id: "answer", delta: "Hang Seng answer" });
          writer.write({ type: "text-end", id: "answer" });
          writer.write({ type: "finish", messageMetadata: { model: settings.api.model, baseUrl: "", durationMs: 25, completed: true } });
        },
      }) });
    });
    await submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Hang Seng answer");
  });
});

describe.each(["hkex-db", "hk"])("shared research UI for %s", (useCaseId) => {
  it("shimmers the status, thinking, running tool and chart placeholder while researching, and clears every shimmer when done", async () => {
    await act(async () => root.render(createElement(HkexAgentWorkspace, { uc: USE_CASE_BY_ID[useCaseId] })));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let releaseChart!: () => void;
    const chartGate = new Promise<void>((resolve) => { releaseChart = resolve; });
    fetchMock.mockImplementationOnce(async () => createUIMessageStreamResponse({ stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "reasoning-start", id: "thinking" });
        writer.write({ type: "reasoning-delta", id: "thinking", delta: "Planning" });
        writer.write({ type: "data-tool", id: "plan", data: { id: "plan", tool: "planResearch", status: "running", summary: "Planning." } });
        await gate;
        writer.write({ type: "data-tool", id: "plan", data: { id: "plan", tool: "planResearch", status: "complete", summary: "Planned." } });
        writer.write({ type: "reasoning-end", id: "thinking" });
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: "Answer" });
        writer.write({ type: "text-end", id: "answer" });
        writer.write({ type: "data-tool", id: "chart", data: { id: "chart", tool: "chooseChart", status: "running", summary: "Deciding." } });
        await chartGate;
        writer.write({ type: "data-tool", id: "chart", data: { id: "chart", tool: "chooseChart", status: "complete", summary: "No chart." } });
        writer.write({ type: "finish", messageMetadata: { model: settings.api.model, baseUrl: "", durationMs: 25, completed: true } });
      },
    }) }));
    await edit("textarea", "Research question");
    await submit();
    await vi.waitFor(() => expect(container.querySelector("summary .research-shimmer")).not.toBeNull());
    expect(container.querySelector('[role="status"] .research-shimmer')?.textContent).toBe("Researching your question...");
    expect(container.querySelector('button[aria-label="Expand thinking"] .research-shimmer')?.textContent).toBe("Thinking...");
    expect(container.querySelector("details li .research-shimmer")?.textContent).toContain("planResearch");
    await act(async () => { release(); });
    await vi.waitFor(() => expect(container.querySelector("figure[data-chart-placeholder] .research-shimmer")?.textContent).toBe("Preparing chart..."));
    expect(container.textContent).toContain("Answer");
    await act(async () => { releaseChart(); });
    await vi.waitFor(() => expect(container.querySelector(".research-shimmer")).toBeNull());
    expect(container.querySelector("figure[data-chart-placeholder]")).toBeNull();
  });
});
