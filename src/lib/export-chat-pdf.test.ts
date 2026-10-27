// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { runInsight } from "./engine";
import { createChatPdfContent, exportChatPdf } from "./export-chat-pdf";
import { USE_CASES } from "./usecases";

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); vi.restoreAllMocks(); });

function conversation() {
  const source = document.createElement("div");
  source.innerHTML = `<section>Greeting</section><article><p>My question</p></article><article>
    <div data-pdf-thinking="Full thinking &lt;b&gt;not markup&lt;/b&gt; with tail"><button>Expand thinking</button><div hidden></div></div>
    <details><summary>Research tools</summary><pre>SELECT * FROM example WHERE code = $1</pre><p>Parameters: ["00700"]</p></details>
    <details><summary>Exact data</summary><div class="max-h-64 overflow-auto"><table><tbody><tr><td>Last row</td></tr></tbody></table></div></details>
    <p>Answer</p><div><p>Explanation</p></div><button>Explain these results</button>
    <details data-pdf-exclude><summary>View SQL</summary><pre>Duplicate SQL</pre></details>
  </article><div>Composer</div>`;
  document.body.append(source);
  return source;
}

describe("print-ready conversation snapshot", () => {
  it("includes all turns, full collapsed thinking, closed details and explanations without changing the live UI", () => {
    const source = conversation();
    const original = source.innerHTML;
    const content = createChatPdfContent(source, document);
    expect(content.querySelectorAll("article")).toHaveLength(2);
    expect(content.textContent).toContain("My question");
    expect(content.textContent).toContain("Full thinking <b>not markup</b> with tail");
    expect(content.querySelector("b")).toBeNull();
    expect(content.textContent).toContain("Parameters:");
    expect(content.textContent).toContain("Last row");
    expect(content.textContent).toContain("Explanation");
    expect([...content.querySelectorAll("details")].every((detail) => detail.open)).toBe(true);
    expect(content.querySelector(".overflow-auto")?.hasAttribute("data-pdf-expand")).toBe(true);
    expect(content.textContent).not.toMatch(/Greeting|Composer|Expand thinking|Duplicate SQL|Explain these results/);
    expect(content.querySelector("button")).toBeNull();
    expect(source.innerHTML).toBe(original);
    source.replaceChildren();
    expect(content.textContent).toContain("Answer");
  });

  it.each(USE_CASES.filter((useCase) => useCase.execution !== "database-agent"))("includes unopened report data, SQL and method for $id", (useCase) => {
    const report = runInsight(useCase.questions[0].q, useCase.id);
    const source = conversation();
    const article = source.querySelectorAll("article")[1];
    article.dataset.pdfReportId = report.id;
    const activeTab = document.createElement("pre");
    activeTab.dataset.pdfTabContent = "";
    activeTab.textContent = report.sql;
    article.append(activeTab);
    const content = createChatPdfContent(source, document, [report]);
    expect(content.textContent).toContain(report.sql);
    expect(content.querySelectorAll(".pdf-appendix pre")).toHaveLength(1);
    expect(content.querySelector("[data-pdf-tab-content]")).toBeNull();
    expect(content.querySelectorAll(".pdf-appendix tbody tr")).toHaveLength(report.table.rows.length);
    for (const step of report.steps) expect(content.textContent).toContain(step);
  });

  it("preserves SVG charts with a local background and viewBox", () => {
    const source = document.createElement("div");
    source.style.backgroundColor = "#1c2127";
    source.innerHTML = '<article><figure><div class="recharts-responsive-container"><div style="width:0;height:0"><div class="recharts-wrapper"><svg class="recharts-surface" width="500" height="288"><text style="fill: rgb(255, 255, 255)">Chart label</text><path style="fill: url(http://localhost/#series-gradient)" d="M0 0L20 20"/></svg></div></div></div></figure></article>';
    document.body.append(source);
    const content = createChatPdfContent(source, document);
    const svg = content.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 500 288");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("rgb(28, 33, 39)");
    expect(svg.querySelector("text")?.getAttribute("style")).toContain("rgb(255, 255, 255)");
    expect(svg.querySelector("path")?.getAttribute("style")).toContain("fill:url(#series-gradient)");
    expect(svg.parentElement?.className).toBe("pdf-chart");
    expect(content.querySelector(".recharts-responsive-container")).toBeNull();
  });

  it("fails explicitly for empty conversations and unavailable reports", () => {
    expect(() => createChatPdfContent(document.createElement("div"), document)).toThrow("no messages");
    const source = conversation();
    source.querySelector("article")!.dataset.pdfReportId = "missing";
    expect(() => createChatPdfContent(source, document)).toThrow("no longer available");
  });
});

describe("browser PDF preview", () => {
  it("waits for chart animations and captures their final geometry, not an empty intermediate SVG", async () => {
    const source = conversation();
    const article = source.querySelector("article")!;
    article.dataset.pdfAnimating = "true";
    const previewDocument = document.implementation.createHTMLDocument();
    const preview = { document: previewDocument, opener: window, closed: false, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const exporting = exportChatPdf(source, "Research");
    expect(preview.print).not.toHaveBeenCalled();
    const final = document.createElement("p");
    final.textContent = "Completed chart geometry";
    article.append(final);
    article.dataset.pdfAnimating = "false";
    await exporting;
    expect(previewDocument.body.textContent).toContain("Completed chart geometry");
    expect(preview.print).toHaveBeenCalledOnce();
  });

  it("reports blocked popups and does not open a preview during an explanation", async () => {
    const source = conversation();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(exportChatPdf(source, "Research")).rejects.toThrow("Allow pop-ups");
    expect(open).toHaveBeenCalledOnce();
    source.querySelector("article")!.dataset.pdfBusy = "true";
    await expect(exportChatPdf(source, "Research")).rejects.toThrow("finish");
    expect(open).toHaveBeenCalledOnce();
  });

  it("prepares a safe independent light document and supports reprinting", async () => {
    const source = conversation();
    const previewDocument = document.implementation.createHTMLDocument();
    const preview = { document: previewDocument, opener: window, closed: false, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
    await exportChatPdf(source, "<script>Research</script>");
    expect(preview.opener).toBeNull();
    expect(previewDocument.documentElement.dataset.theme).toBe("light");
    expect(previewDocument.title).toBe("<script>Research</script>");
    expect(previewDocument.querySelector("script")).toBeNull();
    expect(preview.print).toHaveBeenCalledOnce();
    previewDocument.querySelector("button")!.click();
    expect(preview.print).toHaveBeenCalledTimes(2);
    source.replaceChildren();
    expect(previewDocument.body.textContent).toContain("Answer");
  });

  it("waits for styles before printing and closes a failed preview", async () => {
    const source = conversation();
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/example.css"; document.head.append(link);
    const previewDocument = document.implementation.createHTMLDocument();
    const preview = { document: previewDocument, opener: window, closed: false, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
    const exporting = exportChatPdf(source, "Research");
    expect(preview.print).not.toHaveBeenCalled();
    previewDocument.querySelector("link")!.dispatchEvent(new Event("error"));
    await expect(exporting).rejects.toThrow("styles could not load");
    expect(preview.print).not.toHaveBeenCalled();
    expect(preview.close).toHaveBeenCalledOnce();
  });
});
