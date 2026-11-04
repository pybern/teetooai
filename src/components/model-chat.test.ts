// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelChat } from "./model-chat";
import { hkexChartSpecSchema } from "@/lib/hkex-chart";
import type { InsightSummary } from "@/lib/types";
import type { ModelChatResult } from "@/lib/connections";

let root: Root;
let container: HTMLDivElement;
const onSend = vi.fn();
const result: ModelChatResult = {
  message: { role: "assistant", content: "Hello from the saved model." },
  model: "alibaba/qwen3-coder", baseUrl: "https://ai-gateway.vercel.sh/v1", durationMs: 150,
};

async function edit(value: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function click(label: string) {
  await act(async () => {
    [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === label || button.textContent === label)!.click();
  });
}

/** Thinking always starts collapsed; tests that inspect its content open every block first. */
async function expandThinking() {
  await act(async () => {
    for (const button of container.querySelectorAll<HTMLButtonElement>('button[aria-label="Expand thinking"]')) button.click();
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSend.mockReset().mockResolvedValue(result);
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ModelChat, {
      model: result.model, baseUrl: result.baseUrl, unsavedChanges: true, disabled: false, onSend,
    }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("saved-model chat interface", () => {
  it.each(["complete", "error", "cancel"])("shimmers only active thinking and running tools, stopping on %s", async (outcome) => {
    let finish!: (value: ModelChatResult) => void;
    let fail!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research"); await submit();
    expect(container.querySelector('[role="status"] .research-shimmer')?.textContent).toBe("Researching your question...");
    const tools = [
      { id: "running", tool: "planResearch", status: "running" as const, summary: "Planning." },
      { id: "done", tool: "inspectDatabase", status: "complete" as const, summary: "Read coverage." },
    ];
    await act(async () => {
      onSend.mock.calls[0][3]("Live reasoning");
      onSend.mock.calls[0][4](tools);
    });
    expect(container.querySelector('button[aria-label="Expand thinking"] .research-shimmer')?.textContent).toBe("Thinking...");
    expect(container.querySelector("summary .research-shimmer")?.textContent).toContain("Research tools");
    const items = container.querySelectorAll("details li");
    expect(items[0].querySelector(".research-shimmer")?.textContent).toContain("planResearch");
    expect(items[1].querySelector(".research-shimmer")).toBeNull();
    await expandThinking();
    expect(container.querySelector('[aria-label="Thinking process"] .research-shimmer')).toBeNull();
    if (outcome === "cancel") await click("Cancel request");
    else if (outcome === "error") await act(async () => fail(new Error("Stream failed")));
    else await act(async () => finish({ ...result, reasoning: "Live reasoning", tools }));
    expect(container.querySelector(".research-shimmer")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it("stops shimmering a completed tool while research is still pending", async () => {
    onSend.mockImplementationOnce(() => new Promise(() => {}));
    await edit("Research"); await submit();
    await act(async () => onSend.mock.calls[0][4]([
      { id: "query", tool: "queryHkex", status: "running", summary: "Querying." },
    ]));
    expect(container.querySelector("summary .research-shimmer")).not.toBeNull();
    await act(async () => onSend.mock.calls[0][4]([
      { id: "query", tool: "queryHkex", status: "complete", summary: "Finished." },
    ]));
    expect(container.querySelector("details .research-shimmer")).toBeNull();
    expect(container.querySelector('[role="status"] .research-shimmer')).not.toBeNull();
    await click("New chat");
    expect(container.querySelector(".research-shimmer")).toBeNull();
  });
  it.each(["complete", "error", "cancel"])("shimmers while an explanation loads, stopping on %s", async (outcome) => {
    let finish!: (value: ModelChatResult) => void;
    let fail!: (error: Error) => void;
    const onExplain = vi.fn(() => new Promise<ModelChatResult>((resolve, reject) => { finish = resolve; fail = reject; }));
    onSend.mockResolvedValueOnce({ ...result, tools: [{ id: "results", tool: "researchResults", status: "complete", summary: "Ready", explanationId: "reference" }] });
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, onExplain, agentMode: true,
    })));
    await edit("Research"); await submit();
    expect(container.querySelector(".research-shimmer")).toBeNull();
    await click("Explain these results");
    expect(container.querySelector('[role="status"] .research-shimmer')?.textContent).toBe("Preparing your explanation...");
    if (outcome === "cancel") await click("Cancel explanation");
    else if (outcome === "error") await act(async () => fail(new Error("Explanation failed")));
    else await act(async () => finish(result));
    expect(container.querySelector(".research-shimmer")).toBeNull();
  });
  it("offers a read-only SQL preview with bound parameters without another request", async () => {
    const tools = [{ id: "query", tool: "queryHkex", status: "complete", summary: "Returned two rows", sql: "SELECT * FROM example WHERE stock_code = $1", parameters: ["00700"] }];
    onSend.mockResolvedValueOnce({ ...result, tools });
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Export PDF")?.disabled).toBe(true);
    await edit("Show Tencent"); await submit();
    const summary = [...container.querySelectorAll("summary")].find((element) => element.textContent === "View SQL")!;
    expect(summary).toBeTruthy();
    expect(summary.parentElement?.textContent).toContain(tools[0].sql);
    expect(summary.parentElement?.textContent).toContain('["00700"]');
    await act(async () => summary.click());
    expect(onSend).toHaveBeenCalledOnce();
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Export PDF")?.disabled).toBe(false);
    await click("New chat");
    expect(container.textContent).not.toContain("View SQL");
  });
  it("shows an actionable export error when the browser blocks the preview", async () => {
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research"); await submit();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      await click("Export PDF");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Allow pop-ups");
      expect(onSend).toHaveBeenCalledOnce();
    } finally { open.mockRestore(); }
  });
  it("shows server-calculated insights as they arrive, retains them on completion and clears New chat without another call", async () => {
    const insights: InsightSummary = {
      title: "Short-selling value insights (HKD)", headline: "00700 TENCENT has the highest returned value.",
      scope: "Server-calculated from 2 returned rows.", kpis: [{ label: "Returned-stock total", value: "HKD 400" }],
      insights: [{ kind: "concentration", title: "Returned-set concentration", text: "TENCENT accounts for 75% of the returned-stock total; not market share.", tone: "neutral" }],
    };
    const tools = [{ id: "insights", tool: "computeInsights", status: "complete", summary: "Calculated findings", insights }];
    let finish!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research stocks"); await submit();
    await act(async () => onSend.mock.calls[0][4](tools));
    expect(container.textContent).toContain(insights.headline);
    expect(container.textContent).toContain("HKD 400");
    expect(container.textContent).toContain("Returned-set concentration");
    await act(async () => finish({ ...result, tools }));
    expect(container.querySelectorAll('section[aria-label="Short-selling value insights (HKD)"]')).toHaveLength(1);
    expect(onSend).toHaveBeenCalledOnce();
    await click("New chat");
    expect(container.textContent).not.toContain(insights.headline);
    expect(container.textContent).not.toContain("HKD 400");
  });
  it("requests an explanation only on explicit click and never adds it to research context", async () => {
    const onExplain = vi.fn(async (_id: string, _signal: AbortSignal, _onText: (text: string) => void, onReasoning: (text: string) => void): Promise<ModelChatResult> => {
      onReasoning("**Internal explanation reasoning**");
      return { ...result, message: { role: "assistant", content: "Optional AI analysis" } };
    });
    const tools = [{ id: "results", tool: "researchResults", status: "complete", summary: "Ready", explanationId: "server-reference" }];
    onSend.mockResolvedValueOnce({ ...result, tools });
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, onExplain, agentMode: true,
    })));
    await edit("Research request"); await submit();
    expect(onExplain).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("provider charges");
    expect(container.textContent).not.toContain("model call");
    await click("Explain these results");
    expect(onExplain).toHaveBeenCalledOnce();
    expect(onExplain.mock.calls[0][0]).toBe("server-reference");
    expect(container.textContent).toContain("Optional AI analysis");
    expect(container.textContent).not.toContain("Internal explanation reasoning");
    await expandThinking();
    expect(container.textContent).toContain("Internal explanation reasoning");
    expect(container.querySelector('[aria-label="Thinking process"] strong')?.textContent).toBe("Internal explanation reasoning");
    expect(onSend).toHaveBeenCalledOnce();
    await edit("Follow up"); await submit();
    expect(JSON.stringify(onSend.mock.calls[1][0])).not.toContain("Optional AI analysis");
    await click("New chat");
    expect(container.textContent).not.toContain("Optional AI analysis");
  });
  it("shows expiration errors and cancels an in-flight explanation when New chat is selected", async () => {
    const onExplain = vi.fn().mockRejectedValueOnce(new Error("Research results expired."));
    onSend.mockResolvedValueOnce({ ...result, tools: [{ id: "results", tool: "researchResults", status: "complete", summary: "Ready", explanationId: "reference" }] });
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, onExplain, agentMode: true,
    })));
    await edit("Research"); await submit(); await click("Explain these results");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("no longer available");
    const details = [...container.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Error details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("pre")?.textContent).toBe("Research results expired.");
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    onExplain.mockImplementationOnce(() => new Promise(() => {}));
    await click("Explain these results");
    expect([...container.querySelectorAll("summary")].some((item) => item.textContent === "Error details")).toBe(false);
    const signal = onExplain.mock.calls[1][1] as AbortSignal;
    await click("New chat");
    expect(signal.aborted).toBe(true);
  });
  it("preserves failed live research as incomplete without adding it to retry context", async () => {
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    let reject!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await edit("Research HKEX");
    await submit();
    await act(async () => {
      onSend.mock.calls[0][2]("Unfinished finding");
      onSend.mock.calls[0][3]("Earlier provider reasoning");
      onSend.mock.calls[0][4]([
        { id: "done", tool: "inspectDatabase", status: "complete", summary: "Read coverage" },
        { id: "pending", tool: "queryHkex", status: "running", summary: "Querying" },
      ]);
    });
    await act(async () => { reject(new Error("API returned HTTP 503")); });
    await expandThinking();
    expect(container.textContent).toContain("Incomplete research");
    expect(container.textContent).toContain("Unfinished finding");
    expect(container.textContent).toContain("Earlier provider reasoning");
    expect(container.textContent).toContain("Read coverage");
    expect(container.textContent).toContain("Interrupted before completion");
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("HTTP 503");
    expect([...container.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Error details")?.open).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please try again");
    expect(container.textContent).not.toContain("Last reply:");
    expect(container.querySelector("textarea")!.value).toBe("Research HKEX");
    await submit();
    expect(onSend.mock.calls[1][0]).toEqual([{ role: "user", content: "Research HKEX" }]);
    expect(container.textContent).not.toContain("Incomplete research");
    expect(container.textContent).not.toContain("Unfinished finding");
  });
  it("shows live thinking and tool calls, retaining them on failure without restoring instructional copy", async () => {
    let reject!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: result.baseUrl, unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Compare stocks"); await submit();
    await act(async () => {
      onSend.mock.calls[0][3]("Internal planning details");
      onSend.mock.calls[0][4]([{ id: "plan", tool: "planResearch", status: "running", summary: "Planning model calls." }]);
    });
    expect(container.textContent).toContain("Researching your question...");
    expect(container.querySelector('button[aria-label="Expand thinking"]')?.getAttribute("aria-expanded")).toBe("false");
    await expandThinking();
    expect(container.textContent).toContain("Internal planning details");
    expect(container.textContent).toContain("planResearch");
    expect(container.textContent).not.toMatch(/thinking effort|output tokens|Each request has|alibaba|https:/);
    await act(async () => reject(new Error("Research planning reached its 4,096-token output limit.")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Try a shorter question");
    await expandThinking();
    expect(container.textContent).toContain("Incomplete research");
    expect(container.textContent).toContain("Internal planning details");
    expect(container.textContent).toContain("Interrupted before completion");
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("4,096");
  });
  it("shows error details as escaped text without a stack, clears them on retry and resets the disclosure", async () => {
    const message = 'Model stream failed.\n<script>alert("unsafe")</script>';
    const failure = new Error(message);
    failure.stack = "Private server stack must not be shown";
    onSend.mockRejectedValueOnce(failure).mockRejectedValueOnce(new Error("Second failure"));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research"); await submit();
    const details = container.querySelector<HTMLDetailsElement>("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Error details");
    expect(details.querySelector("pre")?.textContent).toBe(message);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain(failure.stack);
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(onSend).toHaveBeenCalledOnce();
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(false);
    await submit();
    const nextDetails = container.querySelector<HTMLDetailsElement>("details")!;
    expect(nextDetails.open).toBe(false);
    expect(nextDetails.querySelector("pre")?.textContent).toBe("Second failure");
    expect(container.textContent).not.toContain(message);
    await click("New chat");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });
  it.each([
    { failure: "Request failed with a returned error", details: "Request failed with a returned error" },
    { failure: { unexpected: "Do not serialize arbitrary errors" }, details: undefined },
  ])("handles non-Error failures without serializing objects: $details", async ({ failure, details }) => {
    onSend.mockRejectedValueOnce(failure);
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research"); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please try again");
    expect(container.querySelector("details pre")?.textContent).toBe(details);
    expect(container.textContent).not.toContain("Do not serialize arbitrary errors");
  });
  it("shows streamed chart tools only in the live agent and retains them after completion", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const chart = hkexChartSpecSchema.parse({
      root: "chart", elements: { chart: { type: "HKEXBarChart", children: [], props: {
        type: "bar", metric: "short_selling_value", currency: "HKD", from: "2026-01-05", to: "2026-01-05",
        truncated: false, points: [{ label: "00700 TENCENT", series: "Market", value: "12345.67" }],
        sources: ["https://www.hkex.com.hk/example"],
      } } },
    });
    const tools = [{ id: "chart-1", tool: "renderChart", status: "complete", summary: "Chart rendered", chart }];
    let finish!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Chart HKD rankings");
    await submit();
    await act(async () => { onSend.mock.calls[0][4](tools); });
    expect(container.querySelectorAll("figure")).toHaveLength(1);
    expect(container.textContent).toContain("12345.67");
    await act(async () => { finish({ ...result, tools }); });
    expect(container.querySelectorAll("figure")).toHaveLength(1);
    expect(container.querySelector("article:last-child figure")).not.toBeNull();
    const answer = [...container.querySelectorAll("article:last-child p")].find((node) => node.textContent === result.message.content)!;
    expect(answer.compareDocumentPosition(container.querySelector("article:last-child figure")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click("New chat");
    expect(container.querySelector("figure")).toBeNull();
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend,
    })));
    onSend.mockResolvedValueOnce({ ...result, tools });
    await edit("Config playground");
    await submit();
    expect(container.querySelector("figure")).toBeNull();
  });
  it("shows a chart placeholder below the answer while the chart step runs, then swaps in the chart", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const sqlChart = {
      type: "bar", title: "GDP by economy", resultTitle: "Largest economies", labelColumn: "entity", valueLabel: "gdp",
      tables: ["public.insightful_dataset_rows"], truncated: false,
      points: [{ label: "United States", series: "gdp", value: 27.4 }, { label: "China", series: "gdp", value: 18.5 }],
    } as const;
    let finish!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Largest economies"); await submit();
    const placeholder = () => container.querySelector("figure[data-chart-placeholder]");
    await act(async () => {
      onSend.mock.calls[0][2]("## Largest economies\n\nAnswer table");
      onSend.mock.calls[0][4]([{ id: "plan", tool: "planResearch", status: "running", summary: "Planning." }]);
    });
    expect(placeholder()).toBeNull();
    const choosing = { id: "chart", tool: "chooseChart", status: "running", summary: "Deciding." };
    await act(async () => { onSend.mock.calls[0][4]([choosing]); });
    expect(placeholder()?.getAttribute("aria-busy")).toBe("true");
    expect(placeholder()?.querySelector(".research-shimmer")?.textContent).toBe("Preparing chart...");
    const heading = [...container.querySelectorAll("h2")].find((node) => node.textContent === "Largest economies")!;
    expect(heading.compareDocumentPosition(placeholder()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const done = [{ ...choosing, status: "complete", summary: "Added 1 chart." }, { id: "render", tool: "renderChart", status: "complete", summary: "Charted.", sqlChart }];
    await act(async () => { onSend.mock.calls[0][4](done); });
    expect(placeholder()).toBeNull();
    expect(container.querySelector("figure[data-sql-chart]")).not.toBeNull();
    await act(async () => { onSend.mock.calls[0][4]([{ ...choosing, status: "error", summary: "No chart was added." }]); });
    expect(placeholder()).toBeNull();
    await act(async () => { finish({ ...result, tools: done }); });
    expect(placeholder()).toBeNull();
  });
  it("places SQL charts after the answer text while streaming and after completion", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const sqlChart = {
      type: "bar", title: "GDP by economy", resultTitle: "Largest economies", labelColumn: "entity", valueLabel: "gdp",
      tables: ["public.insightful_dataset_rows"], truncated: false,
      points: [{ label: "United States", series: "gdp", value: 27.4 }, { label: "China", series: "gdp", value: 18.5 }],
    } as const;
    const tools = [{ id: "sql-chart-1", tool: "renderChart", status: "complete", summary: "Charted", sqlChart }];
    let finish!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Largest economies"); await submit();
    await act(async () => { onSend.mock.calls[0][2]("## Largest economies\n\nAnswer table"); });
    expect(container.querySelector("figure[data-sql-chart]")).toBeNull();
    await act(async () => { onSend.mock.calls[0][4](tools); });
    const after = (node: Element) => [...container.querySelectorAll("h2")].find((heading) => heading.textContent === "Largest economies")!
      .compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(after(container.querySelector("figure[data-sql-chart]")!)).toBeTruthy();
    expect(container.textContent).toContain("GDP by economy");
    await act(async () => { finish({ ...result, message: { role: "assistant", content: "## Largest economies\n\nAnswer table" }, tools }); });
    expect(container.querySelectorAll("figure[data-sql-chart]")).toHaveLength(1);
    expect(after(container.querySelector("article:last-child figure[data-sql-chart]")!)).toBeTruthy();
  });
  it("does not revalidate completed charts while typing or streaming a later answer", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const chart = hkexChartSpecSchema.parse({
      root: "chart", elements: { chart: { type: "HKEXBarChart", children: [], props: {
        type: "bar", metric: "short_selling_value", currency: "HKD", from: "2026-01-05", to: "2026-01-05",
        truncated: false, points: [{ label: "00700 TENCENT", series: "Market", value: "12345.67" }],
        sources: ["https://www.hkex.com.hk/example"],
      } } },
    });
    const tools = [{ id: "chart", tool: "renderChart", status: "complete", summary: "Chart rendered", chart }];
    onSend.mockResolvedValueOnce({ ...result, tools });
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Chart rankings"); await submit();
    const validate = vi.spyOn(hkexChartSpecSchema, "safeParse");
    try {
      await edit("Follow");
      await edit("Follow up");
      expect(validate).not.toHaveBeenCalled();
      let finish!: (value: unknown) => void;
      onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      await submit();
      validate.mockClear();
      await act(async () => onSend.mock.calls[1][3]("Thinking"));
      await act(async () => onSend.mock.calls[1][3]("Thinking more"));
      await act(async () => onSend.mock.calls[1][2]("Another answer"));
      expect(validate).not.toHaveBeenCalled();
      expect(container.querySelectorAll("figure")).toHaveLength(1);
      expect(container.textContent).toContain("Another answer");
      await act(async () => finish(result));
    } finally { validate.mockRestore(); }
  });
  it("keeps a fixed-height panel with an independently scrolling conversation and anchored composer", () => {
    expect(container.querySelector("section")!.classList.contains("h-[52rem]")).toBe(true);
    expect(container.querySelector("section")!.classList.contains("overflow-hidden")).toBe(true);
    const log = container.querySelector('[role="log"]')!;
    expect(log.classList.contains("min-h-0")).toBe(true);
    expect(log.classList.contains("flex-1")).toBe(true);
    expect(log.classList.contains("overflow-y-auto")).toBe(true);
    expect(container.querySelector("form")!.classList.contains("shrink-0")).toBe(true);
    expect(container.querySelector("textarea")!.classList.contains("max-h-40")).toBe(true);
  });
  it("auto-scrolls on each thinking and answer update and when the completed turn replaces them", async () => {
    let resolve!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const log = container.querySelector<HTMLDivElement>('[role="log"]')!;
    let height = 300;
    Object.defineProperty(log, "scrollHeight", { get: () => height, configurable: true });
    await edit("Stream and scroll");
    await submit();
    expect(log.scrollTop).toBe(300);
    height = 500;
    await act(async () => { onSend.mock.calls[0][3]("Thinking update"); });
    expect(log.scrollTop).toBe(500);
    height = 700;
    await act(async () => { onSend.mock.calls[0][3]("Thinking update with more details"); });
    expect(log.scrollTop).toBe(700);
    height = 900;
    await act(async () => { onSend.mock.calls[0][2]("Answer update"); });
    expect(log.scrollTop).toBe(900);
    height = 1000;
    await act(async () => { resolve({ ...result, reasoning: "Thinking update with more details" }); });
    expect(log.scrollTop).toBe(1000);
  });
  it("sends user text with successful conversation context and shows model identity and latency", async () => {
    expect(container.textContent).toContain("previously saved settings");
    await edit("  Hello  ");
    await submit();
    expect(onSend.mock.calls[0][0]).toEqual([{ role: "user", content: "Hello" }]);
    expect(container.querySelector('[role="log"]')?.textContent).toContain(result.message.content);
    expect(container.textContent).toContain("150 ms");
    expect(container.querySelector("textarea")!.value).toBe("");
    await edit("Remember my previous message?");
    await submit();
    expect(onSend.mock.calls[1][0]).toEqual([
      { role: "user", content: "Hello" }, result.message,
      { role: "user", content: "Remember my previous message?" },
    ]);
    await click("New chat");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    await edit("Fresh start");
    await submit();
    expect(onSend.mock.calls[2][0]).toEqual([{ role: "user", content: "Fresh start" }]);
  });
  it("keeps failed prompts for retry and does not insert fake assistant replies", async () => {
    onSend.mockRejectedValueOnce(new Error("Save your API settings before starting a model chat."));
    await edit("Hello");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Save your API settings");
    expect(container.querySelector("textarea")!.value).toBe("Hello");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    await submit();
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("renders incremental feedback before completion, then commits a single assistant turn", async () => {
    let resolve!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await edit("Stream this");
    await submit();
    await act(async () => { onSend.mock.calls[0][2]("Hello"); });
    expect(container.querySelector('[role="log"]')?.textContent).toContain("Hello");
    expect(container.textContent).toContain("Receiving model reply");
    expect(container.textContent).toContain("0 completed turns");
    await act(async () => { onSend.mock.calls[0][2](result.message.content); resolve(result); });
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.textContent).toContain("1 completed turns");
    expect(container.textContent).not.toContain("Receiving model reply");
  });
  it("discards a failed partial response and retries only the original draft", async () => {
    let reject!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await edit("Keep this draft");
    await submit();
    await act(async () => { onSend.mock.calls[0][2]("Incomplete answer"); });
    expect(container.textContent).toContain("Incomplete answer");
    await act(async () => { reject(new Error("Provider stream disconnected. Please retry.")); });
    expect(container.textContent).not.toContain("Incomplete answer");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("disconnected");
    expect(container.querySelector("textarea")!.value).toBe("Keep this draft");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    await submit();
    expect(onSend.mock.calls[1][0]).toEqual([{ role: "user", content: "Keep this draft" }]);
  });
  it.each([false, true])("renders safe Markdown in streaming and completed thinking (agent=%s)", async (agentMode) => {
    let finish!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode,
    })));
    await edit("Explain your approach"); await submit();
    await act(async () => onSend.mock.calls[0][3]("## Approach\n\n**Check coverage**\n\n```sql\nSELECT"));
    await expandThinking();
    let panel = container.querySelector('[aria-label="Thinking process"]')!;
    expect(panel.querySelector("h2")?.textContent).toBe("Approach");
    expect(panel.querySelector("strong")?.textContent).toBe("Check coverage");
    expect(panel.querySelector("pre code")?.textContent).toContain("SELECT");
    const reasoning = [
      "## Approach", "", "**Check coverage** and *compare* `stock_code`.", "",
      "- Read stored dates", "- Keep currencies separate", "",
      "| Stock | Currency |", "| --- | --- |", "| Tencent | HKD |", "",
      "[HKEX](https://www.hkex.com.hk)", "", "```sql", "SELECT stock_code;", "```", "",
      '<script>alert("unsafe")</script>', "", "[Unsafe](javascript:alert(1))",
    ].join("\n");
    await act(async () => onSend.mock.calls[0][3](reasoning));
    const assertMarkdown = () => {
      panel = container.querySelector('[aria-label="Thinking process"]')!;
      expect(panel.querySelector("strong")?.textContent).toBe("Check coverage");
      expect(panel.querySelector("em")?.textContent).toBe("compare");
      expect(panel.querySelector("ul li")?.textContent).toBe("Read stored dates");
      expect(panel.querySelector("tbody td")?.textContent).toBe("Tencent");
      expect(panel.querySelector("pre code")?.textContent).toContain("SELECT stock_code;");
      const link = panel.querySelector('a[href="https://www.hkex.com.hk"]')!;
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(panel.querySelector("script")).toBeNull();
      expect(panel.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(panel.closest("[data-pdf-thinking]")?.getAttribute("data-pdf-thinking")).toBe(reasoning);
    };
    assertMarkdown();
    await click("Collapse thinking");
    expect(panel.querySelector("strong")).toBeNull();
    await click("Expand thinking");
    assertMarkdown();
    await act(async () => finish({ ...result, reasoning }));
    await expandThinking();
    assertMarkdown();
  });
  it("retains formatted thinking when a research stream fails", async () => {
    let fail!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: "", unsavedChanges: false, disabled: false, onSend, agentMode: true,
    })));
    await edit("Research"); await submit();
    await act(async () => onSend.mock.calls[0][3]("**Checking stored dates**"));
    await act(async () => fail(new Error("Stream disconnected")));
    await expandThinking();
    expect(container.textContent).toContain("Incomplete research");
    expect(container.querySelector('[aria-label="Thinking process"] strong')?.textContent).toBe("Checking stored dates");
  });
  it("starts thinking collapsed while streaming and after completion, and expands into a fixed-height block on request", async () => {
    let resolve!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await edit("Think about this");
    await submit();
    await act(async () => { onSend.mock.calls[0][3]("Short thinking"); });
    const toggle = () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toBe("Thinking...");
    expect(container.textContent).not.toContain("Short thinking");
    expect(container.textContent).toContain("Receiving model thinking");
    const contentId = toggle().getAttribute("aria-controls")!;
    expect(document.getElementById(contentId)?.hidden).toBe(true);
    expect(document.getElementById(contentId)?.parentElement?.classList.contains("h-56")).toBe(false);
    const reasoning = `${"r".repeat(1200)}<script>thinking tail</script>`;
    await act(async () => { onSend.mock.calls[0][3](reasoning); });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-pdf-thinking]")?.getAttribute("data-pdf-thinking")).toBe(reasoning);
    await click("Expand thinking");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(contentId)?.parentElement?.classList.contains("h-56")).toBe(true);
    expect(document.getElementById(contentId)?.classList.contains("overflow-y-auto")).toBe(true);
    expect(document.getElementById(contentId)?.textContent).toBe(reasoning);
    expect(container.querySelector("script")).toBeNull();
    await act(async () => { onSend.mock.calls[0][3](`${reasoning} live update`); });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("live update");
    await click("Collapse thinking");
    expect(document.getElementById(contentId)?.textContent).toBe("");
    await act(async () => {
      onSend.mock.calls[0][2](result.message.content);
      resolve({ ...result, reasoning });
    });
    expect(container.textContent).not.toContain("Receiving model thinking");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("thinking tail");
    await expandThinking();
    expect(container.querySelectorAll("article")[1].textContent).toContain("thinking tail");
    await edit("Follow up");
    await submit();
    expect(onSend.mock.calls[1][0]).toEqual([
      { role: "user", content: "Think about this" }, result.message, { role: "user", content: "Follow up" },
    ]);
    await click("New chat");
    expect(container.textContent).not.toContain("thinking tail");
  });
  it.each([
    { reasoning: "x".repeat(1200) },
    { reasoning: "x".repeat(1201) },
    { reasoning: Array(18).fill("line").join("\n") },
    { reasoning: Array(80).fill("line").join("\n") },
  ].flatMap((test) => [false, true].map((agentMode) => ({ ...test, agentMode }))))("collapses completed thinking regardless of length (agent=$agentMode)", async ({ reasoning, agentMode }) => {
    await act(async () => root.render(createElement(ModelChat, {
      model: result.model, baseUrl: result.baseUrl, unsavedChanges: false, disabled: false, onSend, agentMode,
    })));
    onSend.mockResolvedValueOnce({ ...result, reasoning });
    await edit("Threshold test");
    await submit();
    expect(container.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain(reasoning);
    await expandThinking();
    expect(container.textContent).toContain(reasoning);
  });
  it("follows new thinking until the reader scrolls up, then resumes when they return to the bottom", async () => {
    onSend.mockImplementationOnce(() => new Promise(() => {}));
    await edit("Follow thinking"); await submit();
    await act(async () => onSend.mock.calls[0][3]("First thinking"));
    await expandThinking();
    const panel = container.querySelector<HTMLDivElement>('[aria-label="Thinking process"]')!;
    let height = 1000;
    Object.defineProperties(panel, {
      scrollHeight: { get: () => height }, clientHeight: { value: 160 },
    });
    await act(async () => onSend.mock.calls[0][3]("More thinking"));
    expect(panel.scrollTop).toBe(1000);
    await act(async () => { panel.scrollTop = 100; panel.dispatchEvent(new Event("scroll")); });
    height = 1200;
    await act(async () => onSend.mock.calls[0][3]("Thinking continues while reading earlier text"));
    expect(panel.scrollTop).toBe(100);
    await act(async () => { panel.scrollTop = 1040; panel.dispatchEvent(new Event("scroll")); });
    height = 1400;
    await act(async () => onSend.mock.calls[0][3]("Newest thinking"));
    expect(panel.scrollTop).toBe(1400);
    expect(panel.tabIndex).toBe(0);
    await click("Collapse thinking");
    await act(async () => onSend.mock.calls[0][3]("Thinking received while manually collapsed"));
    expect(panel.hidden).toBe(true);
    await click("Expand thinking");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("Thinking received while manually collapsed");
    expect(panel.scrollTop).toBe(1400);
  });
  it("removes failed or cancelled thinking and ignores stale reasoning updates", async () => {
    let reject!: (error: Error) => void;
    onSend.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await edit("Keep the draft");
    await submit();
    await act(async () => { onSend.mock.calls[0][3]("Partial thinking"); });
    await act(async () => { reject(new Error("Interrupted")); });
    expect(container.textContent).not.toContain("Partial thinking");
    expect(container.querySelector("textarea")!.value).toBe("Keep the draft");
    onSend.mockImplementationOnce(() => new Promise(() => {}));
    await submit();
    await act(async () => { onSend.mock.calls[1][3]("Cancelled thinking"); });
    await click("Cancel request");
    await act(async () => { onSend.mock.calls[1][3]("Late thinking"); });
    expect(container.textContent).not.toContain("Cancelled thinking");
    expect(container.textContent).not.toContain("Late thinking");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });
  it("cancels requests and ignores late replies", async () => {
    let resolve!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await edit("Slow request");
    await submit();
    expect(container.textContent).toContain("Waiting for model feedback");
    await submit();
    expect(onSend).toHaveBeenCalledOnce();
    await click("Cancel request");
    expect(onSend.mock.calls[0][1].aborted).toBe(true);
    expect(container.querySelector("textarea")!.value).toBe("Slow request");
    await act(async () => { onSend.mock.calls[0][2]("Late partial answer"); resolve(result); });
    expect(container.textContent).not.toContain("Late partial answer");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("cancelled");
  });
  it("clears and cancels an in-flight request on new chat", async () => {
    onSend.mockImplementationOnce(() => new Promise(() => {}));
    await edit("Pending");
    await submit();
    await click("New chat");
    expect(onSend.mock.calls[0][1].aborted).toBe(true);
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(container.textContent).not.toContain("Waiting for model feedback");
  });
  it("escapes model markup and rejects empty feedback", async () => {
    onSend.mockResolvedValueOnce({ ...result, message: { role: "assistant", content: '<script>alert("unsafe")</script>' } });
    await edit("Show markup");
    await submit();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<script>alert("unsafe")</script>');
    onSend.mockResolvedValueOnce({ ...result, message: { role: "assistant", content: " " } });
    await edit("Empty response");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("no assistant feedback");
    expect(container.querySelectorAll("article")).toHaveLength(2);
  });
  it("renders assistant Markdown while preserving plain user text and raw conversation context", async () => {
    const markdown = [
      "## Findings", "", "**Important** and *notable*, with `inline code`.", "",
      "- First item", "- Second item", "", "1. Ordered item", "",
      "> Source caveat", "", "[Source](https://www.hkex.com.hk)", "",
      "| Stock | Value |", "| --- | ---: |", "| 00700 | 123 |", "",
      "```sql", "SELECT stock_code FROM example;", "```",
    ].join("\n");
    onSend.mockResolvedValueOnce({ ...result, message: { role: "assistant", content: markdown } });
    await edit("**Keep my prompt literal**");
    await submit();
    const [user, assistant] = container.querySelectorAll("article");
    expect(user.textContent).toContain("**Keep my prompt literal**");
    expect(user.querySelector("strong")).toBeNull();
    expect(assistant.querySelector("h2")?.textContent).toBe("Findings");
    expect(assistant.querySelector("strong")?.textContent).toBe("Important");
    expect(assistant.querySelector("em")?.textContent).toBe("notable");
    expect(assistant.querySelectorAll("ul li")).toHaveLength(2);
    expect(assistant.querySelector("ol li")?.textContent).toBe("Ordered item");
    expect(assistant.querySelector("blockquote")?.textContent).toContain("Source caveat");
    expect(assistant.querySelector("a")?.getAttribute("href")).toBe("https://www.hkex.com.hk");
    expect(assistant.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(assistant.querySelector("table tbody td")?.textContent).toBe("00700");
    expect(assistant.querySelector("table")?.parentElement?.classList.contains("overflow-x-auto")).toBe(true);
    expect(assistant.querySelector("pre code")?.textContent).toContain("SELECT stock_code FROM example;");
    await edit("Follow up");
    await submit();
    expect(onSend.mock.calls[1][0][1]).toEqual({ role: "assistant", content: markdown });
  });
  it("renders partial Markdown during streaming and retains formatting after completion", async () => {
    let resolve!: (value: unknown) => void;
    onSend.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await edit("Format the answer");
    await submit();
    await act(async () => { onSend.mock.calls[0][2]("## Streamed\n\n**Par"); });
    expect(container.querySelector('[role="log"] h2')?.textContent).toBe("Streamed");
    expect(container.textContent).toContain("**Par");
    const markdown = "## Streamed\n\n**Partial complete**\n\n```sql\nSELECT 1;";
    await act(async () => { onSend.mock.calls[0][2](markdown); });
    expect(container.querySelector('[role="log"] strong')?.textContent).toBe("Partial complete");
    expect(container.querySelector('[role="log"] pre code')?.textContent).toContain("SELECT 1;");
    await act(async () => {
      resolve({ ...result, message: { role: "assistant", content: `${markdown}\n\`\`\`` } });
    });
    expect(container.querySelector("article strong")?.textContent).toBe("Partial complete");
    expect(container.querySelector("article pre code")?.textContent).toContain("SELECT 1;");
  });
  it("blocks executable links, raw HTML and remote image loading in assistant Markdown", async () => {
    const markdown = [
      '[unsafe](javascript:alert%281%29)',
      '[encoded](jav&#x61;script:alert%281%29)',
      '![tracking image](https://example.invalid/tracker.png)',
      '<img src="x" onerror="alert(1)">',
      '<iframe src="https://example.invalid"></iframe>',
    ].join("\n\n");
    onSend.mockResolvedValueOnce({ ...result, message: { role: "assistant", content: markdown } });
    await edit("Show safe output");
    await submit();
    expect(container.querySelectorAll("img, script, iframe, [onerror]")).toHaveLength(0);
    for (const link of container.querySelectorAll("article a")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    }
    expect(container.textContent).toContain("[Image: tracking image]");
    expect(container.textContent).toContain('<img src="x" onerror="alert(1)">');
  });
  it("enforces conversation and prompt limits without silently dropping context", async () => {
    for (let i = 0; i < 11; i++) { await edit(`Turn ${i}`); await submit(); }
    expect(onSend).toHaveBeenCalledTimes(11);
    await edit("Too many");
    await submit();
    expect(onSend).toHaveBeenCalledTimes(11);
    expect(container.textContent).toContain("Conversation limit reached");
    expect(container.querySelector("textarea")!.maxLength).toBe(16000);
  });
});
