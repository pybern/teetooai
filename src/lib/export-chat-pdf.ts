import { fmt } from "./engine/format";
import type { InsightReport } from "./types";

const PRINT_STYLES = `
  @page { size: A4; margin: 14mm; }
  html { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #fff; color: #1c2127; }
  main { max-width: 960px; margin: auto; }
  .pdf-header { margin-bottom: 24px; border-bottom: 1px solid #dce0e5; padding-bottom: 16px; }
  .pdf-header h1 { font-size: 24px; font-weight: 600; }
  .pdf-header p { margin-top: 8px; color: #5f6b7c; font-size: 12px; }
  .pdf-content article { min-height: 0 !important; margin-bottom: 24px; }
  .pdf-content * { animation: none !important; transition: none !important; }
  .pdf-content [hidden] { display: none !important; }
  .pdf-content details { margin: 12px 0; }
  .pdf-content summary { font-weight: 600; margin-bottom: 8px; }
  .pdf-content figure { break-inside: avoid; margin: 16px 0; }
  .pdf-content [data-slot="chart"], .pdf-content [data-pdf-chart-container] { height: auto !important; aspect-ratio: auto !important; }
  .pdf-content .pdf-chart { width: 100%; margin: 8px 0; break-inside: avoid; }
  .pdf-content svg { max-width: 100%; }
  .pdf-content svg.recharts-surface { height: auto !important; max-height: 140mm; }
  .pdf-content .recharts-legend-item-text { color: #1c2127 !important; }
  .pdf-content .recharts-default-legend svg { border: 1px solid #64748b; }
  .pdf-content [data-pdf-expand] { height: auto !important; max-height: none !important; overflow: visible !important; }
  .pdf-content .pdf-thinking { border-left: 2px solid #8f99a8; padding: 12px; margin: 12px 0; }
  .pdf-content .pdf-thinking p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
  .pdf-content .truncate { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; overflow-wrap: anywhere; }
  .pdf-content pre { white-space: pre-wrap !important; overflow-wrap: anywhere; overflow: visible !important; font-size: 11px; }
  .pdf-content table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
  .pdf-content th, .pdf-content td { padding: 6px; border: 1px solid #dce0e5; overflow-wrap: anywhere; }
  .pdf-content thead { display: table-header-group; position: static !important; }
  .pdf-content tr { break-inside: avoid; }
  .pdf-content h2, .pdf-content h3, .pdf-content summary { break-after: avoid; }
  .pdf-content h3 { font-weight: 600; margin: 16px 0 8px; }
  .pdf-content a { overflow-wrap: anywhere; }
  .pdf-content .pdf-appendix ol { list-style: decimal; padding-left: 20px; }
  .pdf-print-button { margin: 0 0 20px; border: 1px solid #8f99a8; padding: 8px 12px; }
  @media print {
    body { padding: 0; }
    .pdf-print-button { display: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

function appendReportData(document: Document, article: Element, report: InsightReport) {
  article.querySelectorAll("[data-pdf-tab-content]").forEach((element) => element.remove());
  const appendix = document.createElement("section");
  appendix.className = "pdf-appendix";
  const heading = (text: string) => {
    const element = document.createElement("h3");
    element.textContent = text;
    appendix.append(element);
  };
  heading("Data");
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const column of report.table.columns) {
    const cell = document.createElement("th");
    cell.textContent = column.label;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const row of report.table.rows) {
    const line = body.insertRow();
    for (const column of report.table.columns) {
      const value = row[column.key];
      line.insertCell().textContent = typeof value === "number" && column.format
        ? fmt(value, column.format) : value === null || value === undefined ? "Unavailable" : String(value);
    }
  }
  appendix.append(table);
  heading("SQL query");
  const sql = document.createElement("pre");
  sql.textContent = report.sql;
  appendix.append(sql);
  heading("Calculation steps");
  const steps = document.createElement("ol");
  for (const step of report.steps) {
    const item = document.createElement("li");
    item.textContent = step;
    steps.append(item);
  }
  appendix.append(steps);
  article.append(appendix);
}

function chartBackground(element: Element): string {
  for (let surface: Element | null = element; surface; surface = surface.parentElement) {
    const color = element.ownerDocument.defaultView!.getComputedStyle(surface).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return "#ffffff";
}

export function createChatPdfContent(source: HTMLElement, document: Document, reports: InsightReport[] = []): HTMLElement {
  const content = document.createElement("div");
  content.className = "pdf-content";
  const reportById = new Map(reports.map((report) => [report.id, report]));
  const articles = source.querySelectorAll<HTMLElement>(":scope > article");
  if (!articles.length) throw new Error("There are no messages to export yet.");
  for (const article of articles) {
    const copy = document.importNode(article, true);
    const sourceSvgs = article.querySelectorAll<SVGSVGElement>(".recharts-wrapper > svg.recharts-surface");
    const copies = copy.querySelectorAll<SVGSVGElement>(".recharts-wrapper > svg.recharts-surface");
    sourceSvgs.forEach((svg, index) => {
      const snapshot = copies[index];
      const originals = [svg, ...svg.querySelectorAll("*")];
      const targets = [snapshot, ...snapshot.querySelectorAll("*")];
      originals.forEach((element, item) => {
        const style = element.ownerDocument.defaultView!.getComputedStyle(element);
        for (const property of ["fill", "stroke", "color", "font-family", "font-size", "font-weight", "opacity"]) {
          const value = style.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g, "url(#$1)");
          if (value) targets[item].setAttribute("style", `${targets[item].getAttribute("style") ?? ""};${property}:${value}`);
        }
      });
      const width = svg.getAttribute("width");
      const height = svg.getAttribute("height");
      if (!snapshot.hasAttribute("viewBox") && width && height) snapshot.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("width", "100%");
      background.setAttribute("height", "100%");
      background.setAttribute("fill", chartBackground(svg));
      snapshot.prepend(background);
      const chart = snapshot.closest(".recharts-responsive-container") ?? snapshot.parentElement!;
      const legend = chart.querySelector<HTMLElement>(".recharts-legend-wrapper");
      const frame = document.createElement("div");
      frame.className = "pdf-chart";
      snapshot.style.position = "static";
      snapshot.style.width = "100%";
      snapshot.style.height = "auto";
      frame.append(snapshot);
      if (legend) { legend.removeAttribute("style"); frame.append(legend); }
      chart.replaceWith(frame);
    });
    copy.querySelectorAll<HTMLElement>("[data-pdf-thinking]").forEach((panel) => {
      const heading = document.createElement("h3");
      heading.textContent = "Thinking";
      const text = document.createElement("p");
      text.textContent = panel.dataset.pdfThinking ?? "";
      panel.replaceChildren(heading, text);
      panel.className = "pdf-thinking";
      panel.removeAttribute("data-pdf-thinking");
    });
    copy.querySelectorAll<HTMLDetailsElement>("details").forEach((element) => { element.open = true; });
    copy.querySelectorAll("button, input, textarea, script, iframe, [data-pdf-exclude], .recharts-tooltip-wrapper").forEach((element) => element.remove());
    copy.querySelectorAll<HTMLElement>(".overflow-auto, .overflow-x-auto, .overflow-y-auto").forEach((element) => { element.dataset.pdfExpand = ""; });
    const reportId = copy.dataset.pdfReportId;
    if (reportId) {
      const report = reportById.get(reportId);
      if (!report) throw new Error("A report is no longer available. Please try exporting again.");
      appendReportData(document, copy, report);
    }
    content.append(copy);
  }
  return content;
}

export async function exportChatPdf(source: HTMLElement, title: string, reports: InsightReport[] = []): Promise<void> {
  if (source.querySelector('[data-pdf-busy="true"], article[aria-busy="true"]')) throw new Error("Wait for the current response to finish before exporting.");
  const preview = window.open("", "_blank", "width=1100,height=850");
  if (!preview) throw new Error("Allow pop-ups for this site, then try exporting again.");
  preview.opener = null;
  const document = preview.document;
  try {
    document.body.textContent = "Preparing PDF...";
    if (source.querySelector('[data-pdf-animating="true"]')) {
      const articles = [...source.querySelectorAll(":scope > article")];
      let observer: MutationObserver | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (source.querySelector('[data-pdf-animating="true"]')) return;
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
              if (!source.querySelector('[data-pdf-animating="true"]')) resolve();
            }));
          };
          observer = new MutationObserver(check);
          observer.observe(source, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pdf-animating"] });
          timer = setTimeout(() => reject(new Error("The charts are still preparing. Please try exporting again.")), 15000);
          check();
        });
      } finally { observer?.disconnect(); clearTimeout(timer); }
      if (articles.some((article) => !source.contains(article))) throw new Error("The conversation changed during export. Please try again.");
    }
    const content = createChatPdfContent(source, source.ownerDocument, reports);
    document.title = title;
    document.documentElement.lang = source.ownerDocument.documentElement.lang || "en";
    document.documentElement.className = source.ownerDocument.documentElement.className;
    document.documentElement.dataset.theme = "light";
    document.body.className = source.ownerDocument.body.className;
    const charset = document.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    document.head.append(charset);
    const styles = [...source.ownerDocument.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')].map((original) => {
      if (original.tagName === "STYLE") {
        document.head.append(document.importNode(original, true));
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = (original as HTMLLinkElement).href;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("The report styles could not load. Please try again."));
        document.head.append(link);
      });
    });
    const style = document.createElement("style");
    style.textContent = PRINT_STYLES;
    document.head.append(style);
    const main = document.createElement("main");
    const button = document.createElement("button");
    button.className = "pdf-print-button";
    button.textContent = "Print / Save as PDF";
    button.onclick = () => preview.print();
    const header = document.createElement("header");
    header.className = "pdf-header";
    const heading = document.createElement("h1");
    heading.textContent = title;
    const date = document.createElement("p");
    date.textContent = `Exported ${new Date().toLocaleString()}`;
    header.append(heading, date);
    main.append(button, header, document.importNode(content, true));
    document.body.replaceChildren(main);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => { await Promise.all(styles); if (document.fonts) await document.fonts.ready; })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The print preview took too long to load. Please try again.")), 15000); }),
      ]);
    } finally { clearTimeout(timer); }
    if (preview.closed) throw new Error("The print preview was closed. Please try exporting again.");
    preview.focus();
    preview.print();
  } catch (error) {
    preview.close();
    throw error;
  }
}
