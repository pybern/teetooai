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
      expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: "user", content: "Rank HKD" }] });
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
    expect(container.textContent).not.toContain("Save your database settings");
    expect(container.querySelector("textarea")!.value).toBe("Rank HKD");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hkex/chat");
  });
});
