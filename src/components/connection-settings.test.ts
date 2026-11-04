// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTIONS } from "@/lib/connections";
import { ConnectionSettings } from "./connection-settings";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { PublicConnections } from "@/lib/connections";

let root: Root;
let container: HTMLDivElement;
let catalogRequests: { settings: { baseUrl: string; apiKey?: string }; signal: AbortSignal }[];
const fetchMock = vi.fn();
const catalog = ["alibaba/qwen3-coder", "openai/gpt-4.1-mini"];

async function edit(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function loadCatalog() {
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
}

async function chooseEffort(value: string) {
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Thinking effort"]')!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function unlock() {
  await edit('input[type="password"]', "test-admin-token-with-at-least-32-characters");
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await loadCatalog();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  catalogRequests = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (url === "/api/config") {
      return { ok: true, json: async () => ({
        api: { ...DEFAULT_CONNECTIONS.api, apiKey: undefined, hasApiKey: false },
        database: { ...DEFAULT_CONNECTIONS.database, password: undefined, hasPassword: false },
      }) };
    }
    if (url === "/api/config/models") {
      catalogRequests.push({ settings: JSON.parse(init.body as string).settings, signal: init.signal as AbortSignal });
      return { ok: true, json: async () => ({
        models: catalog, reasoningEfforts: { "alibaba/qwen3-coder": ["none", "low", "high", "max"], "openai/gpt-4.1-mini": [] },
      }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(createElement(ConnectionSettings)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("automatic model dropdown loading", () => {
  it("shows only catalog-advertised effort levels and resets when model or endpoint changes", async () => {
    await unlock();
    expect(container.querySelector('select[aria-label="Thinking effort"]')).toBeNull();
    await edit('input[aria-label="Model"]', "alibaba/qwen3-coder");
    const values = () => [...container.querySelectorAll("select option")].map((option) => option.getAttribute("value"));
    expect(values()).toEqual(["", "none", "low", "high", "max"]);
    await chooseEffort("high");
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("high");
    await edit('input[aria-label="Model"]', "openai/gpt-4.1-mini");
    expect(container.querySelector("select")).toBeNull();
    await edit('input[aria-label="Model"]', "alibaba/qwen3-coder");
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("");
    await chooseEffort("max");
    await edit('input[type="url"]', "https://custom.example/v1");
    expect(container.querySelector("select")).toBeNull();
  });
  it("tests and persists the selected effort, restores it on unlock and allows clearing an unverified value", async () => {
    const saved: PublicConnections = {
      api: { baseUrl: DEFAULT_CONNECTIONS.api.baseUrl, model: "alibaba/qwen3-coder", reasoningEffort: "high", hasApiKey: false },
      database: { ...DEFAULT_CONNECTIONS.database, hasPassword: false },
    };
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => saved }));
    await unlock();
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("high");
    await chooseEffort("max");
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/config/test");
      expect(JSON.parse(init.body as string).settings.reasoningEffort).toBe("max");
      return { ok: true, json: async () => ({ ok: true, feedback: "Confirmed", message: "Feedback received", durationMs: 5 }) };
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Test connection")!.click();
    });
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).settings.reasoningEffort).toBe("max");
      return { ok: true, json: async () => ({ ...saved, api: { ...saved.api, reasoningEffort: "max" } }) };
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("max");
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ models: catalog, reasoningEfforts: {} }) }));
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh models")!.click();
    });
    await loadCatalog();
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("max");
    expect(container.querySelector<HTMLOptionElement>('option[value="max"]')!.disabled).toBe(true);
    await chooseEffort("");
    expect(container.querySelector("select")).toBeNull();
  });
  it("indicates the Gateway environment override and restores key entry for custom endpoints", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      api: { ...DEFAULT_CONNECTIONS.api, apiKey: undefined, hasApiKey: false, environmentApiKeyAvailable: true },
      database: { ...DEFAULT_CONNECTIONS.database, password: undefined, hasPassword: false },
    }) }));
    await unlock();
    const key = () => container.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')!;
    expect(key().disabled).toBe(true);
    expect(key().value).toBe("");
    expect(container.textContent).toContain("Using server AI_GATEWAY_API_KEY");
    await edit('input[type="url"]', "https://custom.example/v1");
    expect(key().disabled).toBe(false);
    expect(container.textContent).not.toContain("Using server AI_GATEWAY_API_KEY");
    await edit('input[autocomplete="new-password"]', "custom-provider-key");
    await edit('input[type="url"]', DEFAULT_CONNECTIONS.api.baseUrl);
    expect(key().disabled).toBe(true);
    expect(container.textContent).toContain("Using server AI_GATEWAY_API_KEY");
  });
  it("loads on unlock and reloads after an API key edit without requiring a button click", async () => {
    await unlock();
    const model = () => container.querySelector<HTMLInputElement>('input[aria-label="Model"]')!;
    const options = () => [...container.querySelectorAll("datalist option")].map((option) => option.getAttribute("value"));
    expect(model().disabled).toBe(false);
    expect(options()).toContain("alibaba/qwen3-coder");
    await edit('input[autocomplete="new-password"]', "new-provider-key");
    expect(model().disabled).toBe(false);
    expect(options()).toHaveLength(0);
    await loadCatalog();
    expect(catalogRequests).toHaveLength(2);
    expect(catalogRequests[1].settings.apiKey).toBe("new-provider-key");
    expect(model().disabled).toBe(false);
    expect(options()).toContain("alibaba/qwen3-coder");
  });

  it("debounces URL edits and cancels superseded catalog requests", async () => {
    await unlock();
    await edit('input[type="url"]', "https://first.example/v1");
    await edit('input[type="url"]', "https://second.example/v1");
    await loadCatalog();
    expect(catalogRequests).toHaveLength(2);
    expect(catalogRequests[0].signal.aborted).toBe(true);
    expect(catalogRequests[1].settings.baseUrl).toBe("https://second.example/v1");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Model"]')!.disabled).toBe(false);
  });

  it("keeps fields editable during loading and ignores stale responses", async () => {
    await unlock();
    let resolveOld!: (response: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await edit('input[type="url"]', "https://slow.example/v1");
    await loadCatalog();
    expect(container.querySelector<HTMLInputElement>('input[type="url"]')!.disabled).toBe(false);
    await edit('input[type="url"]', "https://current.example/v1");
    await loadCatalog();
    await act(async () => {
      resolveOld({ ok: true, json: async () => ({ models: ["stale/wrong-model"] }) });
    });
    const values = [...container.querySelectorAll("datalist option")].map((option) => option.getAttribute("value"));
    expect(values).toContain("alibaba/qwen3-coder");
    expect(values).not.toContain("stale/wrong-model");
  });

  it("shows provider failures and automatically recovers when credentials change", async () => {
    await unlock();
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 401, json: async () => ({ error: "Provider rejected the API key." }) }));
    await edit('input[autocomplete="new-password"]', "bad-key");
    await loadCatalog();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Provider rejected the API key.");
    await edit('input[autocomplete="new-password"]', "corrected-key");
    await loadCatalog();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Model"]')!.disabled).toBe(false);
  });

  it("uses one editable combobox for catalog selection, search and custom IDs", async () => {
    await unlock();
    expect(container.querySelectorAll("input[list]")).toHaveLength(1);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    const model = container.querySelector<HTMLInputElement>('input[aria-label="Model"]')!;
    expect(model.list).toBe(container.querySelector("datalist"));
    expect(model.value).toBe(DEFAULT_CONNECTIONS.api.model);
    await edit('input[aria-label="Model"]', "alibaba/qwen3-coder");
    expect(model.value).toBe("alibaba/qwen3-coder");
    await edit('input[aria-label="Model"]', "custom/my-model");
    expect(model.value).toBe("custom/my-model");
    expect(model.checkValidity()).toBe(true);
    await loadCatalog();
    expect(catalogRequests).toHaveLength(1);
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const save = fetchMock.mock.calls.find(([, init]) => init.method === "PUT");
    expect(save).toBeDefined();
    expect(JSON.parse(save![1].body).settings.model).toBe("custom/my-model");
  });

  it("loads, edits and saves per-step output-token limits, leaving blanks to the defaults", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      api: { ...DEFAULT_CONNECTIONS.api, outputTokens: { chart: 1500 }, apiKey: undefined, hasApiKey: false },
      database: { ...DEFAULT_CONNECTIONS.database, password: undefined, hasPassword: false },
    }) }));
    await unlock();
    const field = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label} output-token limit"]`)!;
    expect(field("Planning").value).toBe("");
    expect(field("Planning").placeholder).toBe("4096");
    expect(field("Chart choice").value).toBe("1500");
    expect(field("Explanation").max).toBe("32768");
    await edit('input[aria-label="Planning output-token limit"]', "8000");
    await edit('input[aria-label="Chart choice output-token limit"]', "");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const save = fetchMock.mock.calls.find(([, init]) => init.method === "PUT");
    expect(JSON.parse(save![1].body).settings.outputTokens).toEqual({ planning: 8000 });
  });

  it("keeps chat on saved settings while editing and resets it after an API save", async () => {
    await unlock();
    const savedModel = DEFAULT_CONNECTIONS.api.model;
    await edit('input[aria-label="Model"]', "unsaved/model");
    const chatSection = () => [...container.querySelectorAll("section")].find((section) => section.textContent?.includes("Chat with your saved model"))!;
    expect(chatSection().textContent).toContain(savedModel);
    expect(chatSection().textContent).not.toContain("unsaved/model");
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/config/chat");
      expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: "user", content: "Hello" }] });
      return createUIMessageStreamResponse({ stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id: "reply" });
          writer.write({ type: "text-delta", id: "reply", delta: "Saved model reply" });
          writer.write({ type: "text-end", id: "reply" });
          writer.write({ type: "finish", messageMetadata: {
            model: savedModel, baseUrl: DEFAULT_CONNECTIONS.api.baseUrl, durationMs: 10, completed: true,
          } });
        },
      }) });
    });
    await act(async () => {
      const input = chatSection().querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      chatSection().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(chatSection().textContent).toContain("Saved model reply");
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      api: { ...DEFAULT_CONNECTIONS.api, model: "unsaved/model", hasApiKey: false },
      database: { ...DEFAULT_CONNECTIONS.database, hasPassword: false },
    }) }));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(chatSection().textContent).toContain("unsaved/model");
    expect(chatSection().textContent).not.toContain("Saved model reply");
    expect(chatSection().textContent).not.toContain("You have unsaved API changes");
  });

  it("initializes only the confirmed saved database and blocks unsaved database changes", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      api: { ...DEFAULT_CONNECTIONS.api, hasApiKey: false },
      database: { ...DEFAULT_CONNECTIONS.database, host: "saved-db.example", database: "saved_insights", username: "admin", hasPassword: true },
    }) }));
    await unlock();
    const section = container.querySelector<HTMLElement>('section[aria-label="Database initialization"]')!;
    const checkbox = section.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const button = section.querySelector("button")!;
    expect(section.textContent).toContain("saved_insights at saved-db.example:5432");
    expect(button.disabled).toBe(true);
    await edit('input[placeholder="db.example.com or 10.0.0.5"]', "unsaved-db.example");
    expect(checkbox.disabled).toBe(true);
    expect(section.textContent).toContain("Save your database changes");
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      api: { ...DEFAULT_CONNECTIONS.api, hasApiKey: false },
      database: { ...DEFAULT_CONNECTIONS.database, host: "unsaved-db.example", database: "saved_insights", username: "admin", hasPassword: true },
    }) }));
    const databaseForm = [...container.querySelectorAll("form")].find((form) => form.textContent?.includes("PostgreSQL"))!;
    await act(async () => {
      databaseForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const updated = container.querySelector<HTMLElement>('section[aria-label="Database initialization"]')!;
    expect(updated.textContent).toContain("saved_insights at unsaved-db.example:5432");
    await act(async () => { updated.querySelector<HTMLInputElement>("input")!.click(); });
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/config/database/initialize");
      expect(JSON.parse(init.body as string)).toEqual({ confirm: true });
      return { ok: true, json: async () => ({
        ok: true, database: "saved_insights", host: "unsaved-db.example", port: 5432,
        tables: [{ name: "public.insightful_datasets", status: "created", insertedRows: 13 }], durationMs: 100,
      }) };
    });
    await act(async () => { updated.querySelector("button")!.click(); });
    expect(updated.textContent).toContain("Initialization committed");
    expect(updated.textContent).toContain("created and seeded 13 rows");
  });
});
