import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/lib/types";
import { ChartView, TreeCell } from "./chart-view";

const donut: ChartSpec = {
  id: "donut",
  type: "donut",
  title: "Market share",
  xKey: "label",
  series: [{ key: "value", label: "Market cap" }],
  data: [
    { label: "A long category name that needs to wrap", value: 75 },
    { label: "Other companies", value: 25 },
  ],
};

describe("donut layout", () => {
  it("places a wrapping legend outside the fixed-height chart", () => {
    const html = renderToStaticMarkup(createElement(ChartView, { spec: donut }));
    expect(html).toContain('aria-label="Chart legend"');
    expect(html).toContain("break-words");
    expect(html).toContain(donut.data[0].label);
    expect(html).toContain("75.0%");
    expect(html).toContain("25.0%");
    expect(html.indexOf("Chart legend")).toBeGreaterThan(html.indexOf("recharts-responsive-container"));
  });

  it("preserves all legend entries in compact charts", () => {
    const html = renderToStaticMarkup(createElement(ChartView, { spec: donut, height: 220 }));
    expect(html).toContain("height:220px");
    expect(html).toContain(donut.data[0].label);
    expect(html).toContain(donut.data[1].label);
  });

  it("handles a zero total without invalid percentages", () => {
    const html = renderToStaticMarkup(createElement(ChartView, {
      spec: { ...donut, data: [{ label: "Empty", value: 0 }] },
    }));
    expect(html).toContain("0.0%");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

const cell = {
  x: 20,
  y: 30,
  width: 180,
  height: 100,
  name: "China Mobile",
  value: 1234,
  depth: 1,
  tone: (color: string) => color,
  surface: "#ffffff",
};

describe("treemap tiles", () => {
  it("clips tile content to its own bounds and retains full details", () => {
    const html = renderToStaticMarkup(createElement(TreeCell, cell));
    expect(html).toContain('x="20" y="30" width="180" height="100" overflow="hidden"');
    expect(html).toContain("<title>China Mobile:");
    expect(html).toContain('x="12" y="21"');
    expect(html).toContain('x="12" y="39"');
  });

  it("hides text on tiny tiles without losing the tooltip", () => {
    const html = renderToStaticMarkup(createElement(TreeCell, { ...cell, width: 40, height: 20 }));
    expect(html).not.toContain("<text");
    expect(html).toContain("<title>China Mobile:");
    expect(html).toContain("<rect");
  });

  it("prevents labels from inheriting the treemap outline stroke", () => {
    const html = renderToStaticMarkup(createElement("svg", { stroke: "#ffffff", strokeWidth: 2 },
      createElement(TreeCell, cell),
    ));
    expect(html).toContain('y="21" fill="#ffffff" stroke="none"');
    expect(html).toContain('y="39" fill="#ffffff" stroke="none"');
  });

  it("truncates long names within the tile padding", () => {
    const html = renderToStaticMarkup(createElement(TreeCell, {
      ...cell, width: 80, name: "Sun Hung Kai Properties",
    }));
    expect(html).toContain("<title>Sun Hung Kai Properties:");
    expect(html).toContain("Sun Hun…</text>");
  });

  it("omits values that are too wide for the tile", () => {
    const html = renderToStaticMarkup(createElement(TreeCell, {
      ...cell, width: 80, format: { suffix: " billion dollars" },
    }));
    expect(html).toContain('y="21"');
    expect(html).not.toContain('y="39"');
  });

  it.each([
    ["#252a31", "#ffffff"],
    ["#e5e8eb", "#1c2127"],
  ])("uses contrasting text on %s tiles", (color, ink) => {
    const html = renderToStaticMarkup(createElement(TreeCell, { ...cell, __color: color }));
    expect(html).toContain(`y="21" fill="${ink}"`);
  });

  it("does not draw the root or zero-sized tiles", () => {
    expect(renderToStaticMarkup(createElement(TreeCell, { ...cell, depth: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(TreeCell, { ...cell, width: 0 }))).toBe("");
  });
});