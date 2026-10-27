import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hkexChartSpecSchema } from "@/lib/hkex-chart";
import { HkexChart } from "./hkex-chart";

const spec = hkexChartSpecSchema.parse({
  root: "chart", elements: {
    chart: {
      type: "HKEXBarChart", children: [],
      props: {
        type: "bar", metric: "short_selling_value", currency: "HKD",
        from: "2026-01-05", to: "2026-01-05", truncated: true,
        points: [{ label: "00700 TENCENT", series: "Market", value: "9007199254740993.12" }],
        sources: ["https://www.hkex.com.hk/example"],
      },
    },
  },
});

describe("HKEX json-render registry", () => {
  it("renders an inline chart, exact-value table, coverage and safe provenance links", () => {
    const html = renderToStaticMarkup(createElement(HkexChart, { spec }));
    expect(html).toContain('aria-label="Short-selling value bar chart"');
    expect(html).toContain("recharts-responsive-container");
    expect(html).toContain('data-slot="chart"');
    expect(html).toContain("9007199254740993.12");
    expect(html).toContain("00700 TENCENT");
    expect(html).toContain("2026-01-05");
    expect(html).toContain("Some matching data is not shown");
    expect(html).toContain('href="https://www.hkex.com.hk/example"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it.each([
    ["HKEXHorizontalBarChart", "horizontal-bar"],
    ["HKEXLineChart", "line"],
    ["HKEXAreaChart", "area"],
    ["HKEXDonutChart", "donut"],
  ])("dispatches %s to the shadcn chart renderer", (component, type) => {
    const temporal = type === "line" || type === "area";
    const points = temporal ? [
      { label: "2026-01-05", series: "00700 TENCENT", value: "9007199254740993.12" },
      { label: "2026-01-06", series: "00700 TENCENT", value: "12345.67" },
    ] : [
      ...spec.elements.chart.props.points,
      { label: "00005 HSBC", series: "Market", value: "12345.67" },
    ];
    const variant = hkexChartSpecSchema.parse({
      ...spec, elements: { chart: { ...spec.elements.chart, type: component, props: {
        ...spec.elements.chart.props, type, truncated: false, to: temporal ? "2026-01-06" : "2026-01-05", points,
      } } },
    });
    const html = renderToStaticMarkup(createElement(HkexChart, { spec: variant }));
    expect(html).toContain('data-slot="chart"');
    expect(html).toContain(`Short-selling value ${type} chart`);
    expect(html).toContain("9007199254740993.12");
    if (type === "donut") expect(html).toContain("Shares cover only the stocks shown");
  });
  it("shows null ratios as unavailable with the short-interest caveat", () => {
    const ratio = structuredClone(spec);
    ratio.elements.chart.props.metric = "short_turnover_percent";
    ratio.elements.chart.props.points[0].value = null;
    const html = renderToStaticMarkup(createElement(HkexChart, { spec: ratio }));
    expect(html).toContain("Unavailable");
    expect(html).toContain("not short interest");
    expect(html).not.toContain("<td class=\"p-2 font-mono\">0</td>");
  });
  it("displays a failure rather than rendering a tampered chart", () => {
    const invalid = structuredClone(spec);
    invalid.elements.chart.props.sources[0] = "javascript:alert(1)";
    const html = renderToStaticMarkup(createElement(HkexChart, { spec: invalid }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("javascript:");
  });
});
