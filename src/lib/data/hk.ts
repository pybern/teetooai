import type { Dataset, Row } from "../types";
import snapshot from "./hk-snapshot.json";

type Point = { month: string; close: number };
type Snapshot = {
  fetchedAt: string;
  source: string;
  fx: Record<string, number>;
  indices: { symbol: string; name: string; last: number | null; changePct: number | null; series: Point[] }[];
  stocks: {
    symbol: string;
    name: string;
    longName: string;
    aliases: string[];
    sector: string;
    industry: string;
    financialCurrency: string;
    price: number;
    changePct: number | null;
    marketCapHkdB: number | null;
    trailingPE: number | null;
    forwardPE: number | null;
    dividendYield: number | null;
    priceToBook: number | null;
    change52wPct: number | null;
    analystRating: string | null;
    financials: { year: number; revenueHkdB: number; netIncomeHkdB: number }[];
    series: Point[];
  }[];
};

export const HK: Snapshot = snapshot as Snapshot;
export const HK_FETCHED_AT = HK.fetchedAt;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthRow(p: Point): Pick<Row, "year" | "label"> {
  const [y, m] = p.month.split("-").map(Number);
  return { year: Math.round((y + (m - 1) / 12) * 10000) / 10000, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
}

const asOfMonth = (() => {
  const d = new Date(HK.fetchedAt);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
})();

const yahoo = (path: string) => ({
  name: `Yahoo Finance (snapshot ${asOfMonth})`,
  url: `https://finance.yahoo.com/${path}`,
});

const indices = HK.indices.filter((i) => i.series.length >= 12);

export const hkIndices: Dataset = {
  id: "hk-indices",
  name: "Hang Seng Indices",
  description: "Month-end closing levels of the Hang Seng Index and the Hang Seng China Enterprises Index over the last five years.",
  kind: "panel",
  grain: "month",
  entityLabel: "Index",
  entities: indices.map((i) => ({
    name: i.name,
    aliases: i.symbol === "^HSI" ? ["hang seng index", "hsi", "hang seng", "hong kong market", "hk market"] : ["hscei", "hsce", "china enterprises", "h-shares", "h shares"],
  })),
  metrics: [
    {
      key: "level",
      label: "Index level",
      short: "Level",
      format: { decimals: 0 },
      aliases: ["index", "level", "points", "performance", "performed", "returns", "return"],
      higherIsBetter: true,
      rebaseOnCompare: true,
    },
  ],
  defaultMetric: "level",
  rows: indices.flatMap((i) => i.series.map((p) => ({ entity: i.name, ...monthRow(p), level: p.close }))),
  keywords: ["hang seng", "hsi", "index", "indices", "hong kong", "hk", "market", "benchmark", "hscei"],
  source: { ...yahoo("quote/%5EHSI/"), note: "Month-end closes; current month is month-to-date." },
  asOf: asOfMonth,
};

const stocks = HK.stocks;

export const hkPrices: Dataset = {
  id: "hk-prices",
  name: "HK Blue-Chip Share Prices",
  description: "Five years of month-end, dividend-adjusted share prices for 20 Hang Seng heavyweights, plus each stock rebased to 100.",
  kind: "panel",
  grain: "month",
  entityLabel: "Stock",
  entities: stocks.map((s) => ({ name: s.name, aliases: s.aliases })),
  metrics: [
    {
      key: "indexed",
      label: "Total return (rebased to 100)",
      short: "Rebased",
      format: { decimals: 0 },
      aliases: ["performance", "performed", "return", "returns", "outperform", "outperformed", "rebased", "total return", "stock performance"],
      higherIsBetter: true,
    },
    {
      key: "price",
      label: "Share price",
      short: "Price",
      format: { prefix: "HK$", decimals: 2 },
      aliases: ["price", "share price", "stock price", "trading at", "quote"],
      higherIsBetter: true,
      rebaseOnCompare: true,
    },
  ],
  defaultMetric: "indexed",
  rows: stocks.flatMap((s) => {
    const base = s.series[0]?.close ?? 1;
    return s.series.map((p) => ({
      entity: s.name,
      ...monthRow(p),
      price: p.close,
      indexed: Math.round((p.close / base) * 1000) / 10,
    }));
  }),
  keywords: ["share price", "stock price", "shares", "stock", "stocks", "performance", "chart", "hong kong", "hk"],
  source: { ...yahoo("quote/0700.HK/"), note: "Adjusted closes in HKD; rebased series start at 100 five years ago." },
  asOf: asOfMonth,
};

export const hkValuations: Dataset = {
  id: "hk-valuations",
  name: "HK Blue-Chip Valuations",
  description: "Market cap, P/E, dividend yield, price-to-book and 52-week performance for 20 Hang Seng heavyweights, grouped by sector.",
  kind: "cross-section",
  entityLabel: "Stock",
  entities: stocks.map((s) => ({ name: s.name, aliases: s.aliases })),
  groupAttrs: [{ key: "sector", label: "Sector", aliases: ["sector", "sectors", "industry", "industries", "by sector"] }],
  metrics: [
    {
      key: "marketCap",
      summable: true,
      label: "Market cap",
      format: { prefix: "HK$", suffix: "B", decimals: 0 },
      aliases: ["market cap", "market capitalisation", "market capitalization", "valuable", "biggest companies", "largest companies", "mcap", "size", "weight"],
      higherIsBetter: true,
    },
    {
      key: "trailingPE",
      label: "Trailing P/E",
      short: "P/E",
      format: { suffix: "×", decimals: 1 },
      aliases: ["p/e", "pe ratio", "pe", "price to earnings", "price-to-earnings", "cheap", "cheapest", "expensive", "valuation", "valuations", "multiple"],
      higherIsBetter: false,
    },
    {
      key: "forwardPE",
      label: "Forward P/E",
      short: "Fwd P/E",
      format: { suffix: "×", decimals: 1 },
      aliases: ["forward pe", "forward p/e", "forward earnings"],
      higherIsBetter: false,
    },
    {
      key: "dividendYield",
      label: "Dividend yield",
      short: "Yield",
      format: { suffix: "%", decimals: 2 },
      aliases: ["dividend", "dividends", "yield", "income stocks", "payout"],
      higherIsBetter: true,
    },
    {
      key: "priceToBook",
      label: "Price-to-book",
      short: "P/B",
      format: { suffix: "×", decimals: 2 },
      aliases: ["price to book", "price-to-book", "p/b", "book value"],
      higherIsBetter: false,
    },
    {
      key: "change52w",
      label: "52-week change",
      short: "52w",
      format: { prefix: "+", suffix: "%", decimals: 1 },
      aliases: ["52-week", "52 week", "winners", "losers", "gainers", "past year", "this year", "momentum", "best performing", "worst performing"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "marketCap",
  rows: stocks.map((s) => ({
    entity: s.name,
    sector: s.sector,
    marketCap: s.marketCapHkdB ?? undefined,
    trailingPE: s.trailingPE != null ? Math.round(s.trailingPE * 10) / 10 : undefined,
    forwardPE: s.forwardPE != null ? Math.round(s.forwardPE * 10) / 10 : undefined,
    dividendYield: s.dividendYield ?? undefined,
    priceToBook: s.priceToBook != null ? Math.round(s.priceToBook * 100) / 100 : undefined,
    change52w: s.change52wPct != null ? Math.round(s.change52wPct * 10) / 10 : undefined,
  })),
  keywords: ["valuation", "stocks", "companies", "blue chip", "blue chips", "hong kong", "hk", "hkex", "sector", "listed"],
  source: { ...yahoo("markets/stocks/"), note: "Loss-making companies have no trailing P/E and are excluded from P/E rankings." },
  asOf: asOfMonth,
};

export const hkFinancials: Dataset = {
  id: "hk-financials",
  name: "HK Blue-Chip Financials",
  description: "Annual revenue, net income and net margin for 20 Hang Seng heavyweights, converted to HKD at current FX rates.",
  kind: "panel",
  grain: "year",
  entityLabel: "Company",
  entities: stocks.map((s) => ({ name: s.name, aliases: s.aliases })),
  metrics: [
    {
      key: "revenue",
      summable: true,
      label: "Revenue",
      format: { prefix: "HK$", suffix: "B", decimals: 1 },
      aliases: ["revenue", "revenues", "sales", "top line", "turnover"],
      higherIsBetter: true,
    },
    {
      key: "netIncome",
      summable: true,
      label: "Net income",
      format: { prefix: "HK$", suffix: "B", decimals: 1 },
      aliases: ["net income", "profit", "profits", "earnings", "bottom line", "profitable"],
      higherIsBetter: true,
    },
    {
      key: "netMargin",
      label: "Net margin",
      format: { suffix: "%", decimals: 1 },
      aliases: ["margin", "margins", "net margin", "profitability"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "revenue",
  rows: stocks.flatMap((s) =>
    s.financials.map((f) => ({
      entity: s.name,
      year: f.year,
      revenue: f.revenueHkdB,
      netIncome: f.netIncomeHkdB,
      netMargin: Math.round((f.netIncomeHkdB / f.revenueHkdB) * 1000) / 10,
    })),
  ),
  keywords: ["financials", "fundamentals", "earnings", "income statement", "companies", "annual", "hong kong", "hk"],
  source: {
    ...yahoo("quote/0700.HK/financials/"),
    note: `Fiscal years as reported (Alibaba ends March, SHKP June). Converted at CNY/HKD ${HK.fx.CNY}, USD/HKD ${HK.fx.USD}.`,
  },
  asOf: asOfMonth,
};
