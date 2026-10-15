#!/usr/bin/env node
// Snapshots Hong Kong market data from Yahoo Finance into src/lib/data/hk-snapshot.json.
// Usage: npm run prefetch
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/lib/data/hk-snapshot.json", import.meta.url));
const UA = "Mozilla/5.0";

const INDICES = [
  { symbol: "^HSI", name: "Hang Seng Index" },
  { symbol: "^HSCE", name: "HS China Enterprises" },
  { symbol: "HSTECH.HK", name: "Hang Seng TECH" },
];

const STOCKS = [
  { symbol: "0700.HK", name: "Tencent", aliases: ["tencent", "wechat", "0700", "700"] },
  { symbol: "9988.HK", name: "Alibaba", aliases: ["alibaba", "baba", "9988", "taobao"] },
  { symbol: "0005.HK", name: "HSBC", aliases: ["hsbc", "0005"] },
  { symbol: "1299.HK", name: "AIA", aliases: ["aia", "1299"] },
  { symbol: "0941.HK", name: "China Mobile", aliases: ["china mobile", "0941"] },
  { symbol: "3690.HK", name: "Meituan", aliases: ["meituan", "3690"] },
  { symbol: "1810.HK", name: "Xiaomi", aliases: ["xiaomi", "1810"] },
  { symbol: "0388.HK", name: "HKEX", aliases: ["hkex", "hong kong exchanges", "exchange operator", "0388"] },
  { symbol: "2318.HK", name: "Ping An", aliases: ["ping an", "pingan", "2318"] },
  { symbol: "0939.HK", name: "CCB", aliases: ["ccb", "china construction bank", "construction bank", "0939"] },
  { symbol: "1398.HK", name: "ICBC", aliases: ["icbc", "industrial and commercial bank", "1398"] },
  { symbol: "1211.HK", name: "BYD", aliases: ["byd", "1211"] },
  { symbol: "9618.HK", name: "JD.com", aliases: ["jd", "jd.com", "jingdong", "9618"] },
  { symbol: "0883.HK", name: "CNOOC", aliases: ["cnooc", "0883"] },
  { symbol: "0016.HK", name: "Sun Hung Kai Properties", aliases: ["sun hung kai", "shkp", "0016"] },
  { symbol: "0002.HK", name: "CLP Holdings", aliases: ["clp", "0002"] },
  { symbol: "0001.HK", name: "CK Hutchison", aliases: ["ck hutchison", "ckh", "hutchison", "0001"] },
  { symbol: "2020.HK", name: "ANTA Sports", aliases: ["anta", "2020"] },
  { symbol: "9999.HK", name: "NetEase", aliases: ["netease", "9999"] },
  { symbol: "1024.HK", name: "Kuaishou", aliases: ["kuaishou", "1024"] },
];

const FX = ["CNYHKD=X", "USDHKD=X"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
let crumb = "";

async function get(url, { auth = false, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(auth ? `${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(crumb)}` : url, {
      headers: { "User-Agent": UA, ...(cookie ? { Cookie: cookie } : {}) },
    });
    if (res.ok) return res.json();
    if (i === tries - 1) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await sleep(2 ** i * 1000);
  }
}

async function session() {
  const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const r = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  crumb = await r.text();
  if (!crumb || crumb.includes("<")) throw new Error("Could not obtain Yahoo crumb");
}

async function monthly(symbol) {
  const d = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo`);
  const r = d.chart.result[0];
  const closes = r.indicators.adjclose?.[0]?.adjclose ?? r.indicators.quote[0].close;
  const out = [];
  r.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c == null) return;
    const dt = new Date((ts + (r.meta.gmtoffset ?? 0)) * 1000);
    const month = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    const prev = out[out.length - 1];
    if (prev && prev.month === month) prev.close = round(c);
    else out.push({ month, close: round(c) });
  });
  return out;
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

async function main() {
  await session();
  console.log("Session ready");

  const fx = { HKD: 1 };
  for (const pair of FX) {
    const d = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?range=5d&interval=1d`);
    fx[pair.slice(0, 3)] = d.chart.result[0].meta.regularMarketPrice;
  }
  console.log("FX", fx);

  const indices = [];
  for (const idx of INDICES) {
    try {
      const series = await monthly(idx.symbol);
      if (series.length < 12) throw new Error(`only ${series.length} months of history`);
      const q = (await get(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(idx.symbol)}`, { auth: true }))
        .quoteResponse.result[0];
      indices.push({
        ...idx,
        last: q?.regularMarketPrice ?? null,
        changePct: q?.regularMarketChangePercent ?? null,
        high52: q?.fiftyTwoWeekHigh ?? null,
        low52: q?.fiftyTwoWeekLow ?? null,
        series,
      });
      console.log("Index", idx.symbol, series.length, "months");
    } catch (e) {
      console.warn("Skipping index", idx.symbol, e.message);
    }
    await sleep(300);
  }

  const quotes = (
    await get(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${STOCKS.map((s) => s.symbol).join(",")}`, { auth: true })
  ).quoteResponse.result;
  const quoteBy = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  const stocks = [];
  for (const s of STOCKS) {
    const q = quoteBy[s.symbol];
    if (!q) {
      console.warn("No quote for", s.symbol);
      continue;
    }
    let profile = {};
    let financials = [];
    try {
      const qs = await get(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${s.symbol}?modules=assetProfile,incomeStatementHistory`,
        { auth: true },
      );
      const r = qs.quoteSummary.result[0];
      profile = { sector: r.assetProfile?.sector ?? "Other", industry: r.assetProfile?.industry ?? "Other", employees: r.assetProfile?.fullTimeEmployees ?? null };
      const rate = fx[q.financialCurrency] ?? null;
      financials = (r.incomeStatementHistory?.incomeStatementHistory ?? [])
        .map((st) => ({
          year: Number(st.endDate.fmt.slice(0, 4)),
          revenue: st.totalRevenue?.raw ?? null,
          netIncome: st.netIncome?.raw ?? null,
        }))
        .filter((f) => f.revenue != null && f.netIncome != null && rate)
        .map((f) => ({
          year: f.year,
          revenueHkdB: round((f.revenue * rate) / 1e9, 2),
          netIncomeHkdB: round((f.netIncome * rate) / 1e9, 2),
        }))
        .sort((a, b) => a.year - b.year);
    } catch (e) {
      console.warn("No summary for", s.symbol, e.message);
    }
    const series = await monthly(s.symbol);
    stocks.push({
      symbol: s.symbol,
      name: s.name,
      longName: q.longName ?? q.shortName,
      aliases: s.aliases,
      sector: profile.sector ?? "Other",
      industry: profile.industry ?? "Other",
      employees: profile.employees ?? null,
      currency: q.currency,
      financialCurrency: q.financialCurrency,
      price: q.regularMarketPrice,
      changePct: q.regularMarketChangePercent ?? null,
      marketCapHkdB: q.marketCap ? round(q.marketCap / 1e9, 1) : null,
      trailingPE: q.trailingPE ?? null,
      forwardPE: q.forwardPE ?? null,
      dividendYield: q.dividendYield ?? (q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : null),
      priceToBook: q.priceToBook ?? null,
      change52wPct: q.fiftyTwoWeekChangePercent ?? null,
      high52: q.fiftyTwoWeekHigh ?? null,
      low52: q.fiftyTwoWeekLow ?? null,
      analystRating: q.averageAnalystRating ?? null,
      financials,
      series,
    });
    console.log("Stock", s.symbol, `${series.length} months, ${financials.length} fiscal years`);
    await sleep(300);
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    source: "Yahoo Finance",
    fx,
    indices,
    stocks,
  };
  await writeFile(OUT, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`Wrote ${OUT} (${indices.length} indices, ${stocks.length} stocks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
