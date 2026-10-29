import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInsight } from "@/lib/engine";
import { USE_CASES } from "@/lib/usecases";
import { ChatTurn, ReportBody } from "./insight-card";

vi.mock("./chart-view", () => ({ ChartView: () => null }));

const report = {
  ...runInsight("Top 10 Hong Kong stocks by market cap", "explore"),
  headline: "The largest stocks lead the market.",
  insights: [
    { kind: "comparison" as const, title: "Leader", text: "Tencent leads by market capitalisation." },
    { kind: "concentration" as const, title: "Concentration", text: "The top companies account for most of the total." },
    { kind: "caveat" as const, title: "Coverage", text: "This covers the curated sample only." },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("live response streaming", () => {
  it.each([true, false])("starts progressively with reduced motion set to %s", (reduced) => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
    const html = renderToStaticMarkup(createElement(ChatTurn, {
      entry: {
        id: "stream-test",
        question: report.question,
        useCaseId: report.useCaseId,
        status: "done",
        startedAt: report.createdAt,
        report,
        live: true,
      },
      index: 1,
      onAsk: vi.fn(),
      onRemove: vi.fn(),
      onSettled: vi.fn(),
      pinned: false,
      onTogglePin: vi.fn(),
    }));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(report.headline);
    expect(html).not.toContain("<figure");
  });
});

describe("response context", () => {
  for (const useCase of USE_CASES.filter((item) => item.execution !== "database-agent")) {
    it(`renders context above the visuals for ${useCase.id}`, () => {
      const result = runInsight(useCase.questions[0].q, useCase.id);
      const html = renderToStaticMarkup(createElement(ReportBody, { report: result }));
      expect(html).toContain("max-w-prose");
      expect(html.indexOf("max-w-prose")).toBeLessThan(html.indexOf("<figure"));
    });
  }

  it("keeps execution traces and SQL/method controls alongside charts, findings and sources", () => {
    const html = renderToStaticMarkup(createElement(ChatTurn, {
      entry: { id: "finished", question: report.question, useCaseId: report.useCaseId, status: "done", startedAt: report.createdAt, report },
      index: 1, onAsk: vi.fn(), onRemove: vi.fn(), onSettled: vi.fn(), pinned: false, onTogglePin: vi.fn(),
    }));
    expect(html).toContain("Findings");
    expect(html).toContain("Data");
    expect(html).toContain("Source:");
    expect(html).toContain("tool calls");
    expect(html).toContain("parse_question");
    expect(html).toContain(">SQL<");
    expect(html).toContain(">Method<");
    expect(html).not.toContain(report.sql);
  });
  it("waits for the headline before starting context", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, {
      report, headlineWords: 2, contextWords: 0, stage: 0,
    }));
    expect(html).toContain("The largest");
    expect(html).not.toContain("max-w-prose");
    expect(html).not.toContain("<figure");
  });

  it("reveals only the requested context words before the visuals", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, {
      report, contextWords: 3, stage: 0,
    }));
    expect(html).toContain("Tencent leads by");
    expect(html).not.toContain("market capitalisation");
    expect(html).not.toContain("<figure");
  });

  it("includes the findings and caveat when the answer is settled", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, { report }));
    const context = report.insights.map((insight) => insight.text).join(" ");
    expect(html).toContain(context);
    expect(html.indexOf(context)).toBeLessThan(html.indexOf("<figure"));
  });

  it("does not add context to compact dashboard previews", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, { report, compact: true }));
    expect(html).not.toContain("max-w-prose");
    expect(html).not.toContain(report.insights[0].text);
    expect(html).toContain("<figure");
  });

  it("omits context that only repeats the headline", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, {
      report: { ...report, insights: [{ kind: "trend", title: "Summary", text: report.headline }] },
    }));
    expect(html).not.toContain("max-w-prose");
  });
});