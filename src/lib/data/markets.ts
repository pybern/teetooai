import type { Dataset } from "../types";

const evYears = Array.from({ length: 10 }, (_, i) => 2015 + i);
const evSales = [0.55, 0.75, 1.2, 2.1, 2.1, 3.0, 6.6, 10.2, 13.8, 17.3];
const evShare = [0.7, 0.9, 1.4, 2.4, 2.6, 4.2, 8.7, 14, 18, 22];

export const evGlobal: Dataset = {
  id: "ev-global",
  name: "Global Electric Car Sales",
  description: "Worldwide electric car sales (battery-electric + plug-in hybrid) and their share of all new car sales.",
  kind: "timeseries",
  metrics: [
    {
      key: "sales",
      label: "EV sales",
      short: "Sales",
      format: { suffix: "M", decimals: 1 },
      aliases: ["sales", "sold", "units", "volume", "deliveries", "ev sales", "electric car sales"],
      higherIsBetter: true,
      ceiling: 95,
    },
    {
      key: "share",
      label: "Share of new car sales",
      short: "Market share",
      format: { suffix: "%", decimals: 1 },
      aliases: ["share", "market share", "penetration", "adoption", "percent of new cars"],
      higherIsBetter: true,
      ceiling: 100,
    },
  ],
  defaultMetric: "sales",
  rows: evYears.map((year, i) => ({ year, sales: evSales[i], share: evShare[i] })),
  keywords: ["ev", "evs", "electric", "electric vehicle", "electric vehicles", "electric car", "electric cars", "bev", "phev", "global"],
  source: {
    name: "IEA — Global EV Outlook 2025",
    url: "https://www.iea.org/reports/global-ev-outlook-2025",
    note: "Includes BEV and PHEV passenger cars.",
  },
  asOf: "2024",
};

const regions: { entity: string; sales: number; share: number; aliases?: string[] }[] = [
  { entity: "China", sales: 8.1, share: 38 },
  { entity: "Europe", sales: 3.2, share: 21, aliases: ["eu", "european"] },
  { entity: "United States", sales: 1.4, share: 9.5, aliases: ["usa", "u.s.", "america", "united states"] },
  { entity: "Rest of world", sales: 1.1, share: 3, aliases: ["other", "others", "row"] },
];

export const evRegions: Dataset = {
  id: "ev-regions",
  name: "EV Sales by Region 2023",
  description: "Electric car sales and EV share of new car sales by major market in 2023.",
  kind: "cross-section",
  entityLabel: "Market",
  entities: regions.map((r) => ({ name: r.entity, aliases: r.aliases })),
  metrics: [
    {
      key: "sales",
      summable: true,
      label: "EV sales",
      short: "Sales",
      format: { suffix: "M", decimals: 1 },
      aliases: ["sales", "sold", "units", "volume", "market size"],
      higherIsBetter: true,
    },
    {
      key: "share",
      label: "EV share of new cars",
      short: "EV share",
      format: { suffix: "%", decimals: 1 },
      aliases: ["penetration", "adoption", "share of new", "percent of new", "market share"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "sales",
  rows: regions.map((r) => ({ entity: r.entity, sales: r.sales, share: r.share })),
  keywords: ["ev", "evs", "electric", "region", "regions", "market", "markets", "country", "countries", "china", "europe", "where", "geography", "geographic"],
  source: {
    name: "IEA — Global EV Outlook 2024",
    url: "https://www.iea.org/reports/global-ev-outlook-2024",
  },
  asOf: "2023",
};

type Fin = { revenue: number; netIncome: number };
const companies: { entity: string; aliases: string[]; fy: Record<number, Fin> }[] = [
  {
    entity: "Apple",
    aliases: ["aapl", "iphone"],
    fy: { 2021: { revenue: 365.8, netIncome: 94.7 }, 2022: { revenue: 394.3, netIncome: 99.8 }, 2023: { revenue: 383.3, netIncome: 97.0 }, 2024: { revenue: 391.0, netIncome: 93.7 } },
  },
  {
    entity: "Microsoft",
    aliases: ["msft", "azure"],
    fy: { 2021: { revenue: 168.1, netIncome: 61.3 }, 2022: { revenue: 198.3, netIncome: 72.7 }, 2023: { revenue: 211.9, netIncome: 72.4 }, 2024: { revenue: 245.1, netIncome: 88.1 } },
  },
  {
    entity: "Alphabet",
    aliases: ["google", "googl", "goog", "youtube"],
    fy: { 2021: { revenue: 257.6, netIncome: 76.0 }, 2022: { revenue: 282.8, netIncome: 60.0 }, 2023: { revenue: 307.4, netIncome: 73.8 }, 2024: { revenue: 350.0, netIncome: 100.1 } },
  },
  {
    entity: "Amazon",
    aliases: ["amzn", "aws"],
    fy: { 2021: { revenue: 469.8, netIncome: 33.4 }, 2022: { revenue: 514.0, netIncome: -2.7 }, 2023: { revenue: 574.8, netIncome: 30.4 }, 2024: { revenue: 638.0, netIncome: 59.2 } },
  },
  {
    entity: "Meta",
    aliases: ["facebook", "meta platforms", "instagram"],
    fy: { 2021: { revenue: 117.9, netIncome: 39.4 }, 2022: { revenue: 116.6, netIncome: 23.2 }, 2023: { revenue: 134.9, netIncome: 39.1 }, 2024: { revenue: 164.5, netIncome: 62.4 } },
  },
  {
    entity: "Nvidia",
    aliases: ["nvda", "gpu", "gpus"],
    fy: { 2021: { revenue: 26.9, netIncome: 9.8 }, 2022: { revenue: 27.0, netIncome: 4.4 }, 2023: { revenue: 60.9, netIncome: 29.8 }, 2024: { revenue: 130.5, netIncome: 72.9 } },
  },
  {
    entity: "Tesla",
    aliases: ["tsla"],
    fy: { 2021: { revenue: 53.8, netIncome: 5.5 }, 2022: { revenue: 81.5, netIncome: 12.6 }, 2023: { revenue: 96.8, netIncome: 15.0 }, 2024: { revenue: 97.7, netIncome: 7.1 } },
  },
];

export const bigTech: Dataset = {
  id: "big-tech",
  name: "Big Tech Financials",
  description:
    "Annual revenue, net income and net margin for the 'Magnificent 7' from 10-K filings, fiscal years 2021–2024.",
  kind: "panel",
  entityLabel: "Company",
  entities: companies.map((c) => ({ name: c.entity, aliases: c.aliases })),
  metrics: [
    {
      key: "revenue",
      summable: true,
      label: "Revenue",
      format: { prefix: "$", suffix: "B", decimals: 1 },
      aliases: ["revenue", "revenues", "sales", "top line", "turnover"],
      higherIsBetter: true,
    },
    {
      key: "netIncome",
      summable: true,
      label: "Net income",
      format: { prefix: "$", suffix: "B", decimals: 1 },
      aliases: ["net income", "profit", "profits", "earnings", "bottom line", "profitable"],
      higherIsBetter: true,
    },
    {
      key: "netMargin",
      label: "Net margin",
      format: { suffix: "%", decimals: 1 },
      aliases: ["margin", "margins", "net margin", "profitability", "efficiency"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "revenue",
  rows: companies.flatMap((c) =>
    Object.entries(c.fy).map(([y, f]) => ({
      entity: c.entity,
      year: Number(y),
      revenue: f.revenue,
      netIncome: f.netIncome,
      netMargin: Math.round((f.netIncome / f.revenue) * 1000) / 10,
    })),
  ),
  keywords: ["tech", "big tech", "company", "companies", "magnificent", "mag 7", "stocks", "earnings", "faang", "firms"],
  source: {
    name: "Company 10-K annual reports (SEC EDGAR)",
    url: "https://www.sec.gov/edgar/search/",
    note: "Fiscal years as reported; Microsoft FY ends June, Apple September, Nvidia January (FY2025 shown as 2024).",
  },
  asOf: "FY2024",
};
